import unittest
from math import exp

from lbsim.regional_engine import LiveSimulation
from lbsim.regions import Region, PRESETS


class LiveTests(unittest.TestCase):
    def test_one_shot_excludes_cutoff_arrival_and_drains_network_and_queue(self):
        sim = LiveSimulation([Region('east', 1, 1, 1, 10)], [[200]],
                             arrival_rate=4, service_min=1, service_max=1)
        sim.run_once(1)
        self.assertEqual((sim.offered, sim.completed, sim.rejected), (4, 4, 0))
        self.assertFalse(sim.events)
        self.assertEqual(sim.returning, 0)
        self.assertGreater(sim.now, 4)
        self.check_conservation(sim)
        sim.advance(sim.now + 10)
        self.assertEqual(sim.offered, 4)

    def test_outage_rejects_unfinished_work_and_routes_only_to_healthy_regions(self):
        for policy in ('round_robin', 'nearest', 'least_loaded', 'nearest_under_load'):
            with self.subTest(policy=policy):
                regions = [Region(name, 1, 1, 1, 10) for name in ('east', 'west')]
                sim = LiveSimulation(regions, [[200, 400], [400, 200]],
                                     arrival_rate=20, service_min=1, service_max=1,
                                     policy=policy)
                sim.advance(0.35)
                east, west = sim.pools
                if policy == "nearest":
                    self.assertTrue(east.running and east.waiting and east.flying)
                lost = east.running + len(east.waiting) + east.flying
                sim.set_region_online(0, False)
                sim.set_region_online(0, False)
                self.assertEqual((east.rejected, sim.rejected), (lost, lost))
                self.assertEqual((east.running, len(east.waiting), east.flying), (0, 0, 0))
                sim.advance(0.55)
                self.assertEqual(east.rejected, lost)
                self.assertGreater(west.flying + west.running, 0)
                self.check_conservation(sim)

                sim.set_region_online(1, False)
                rejected, offered = sim.rejected, sim.offered
                sim.advance(0.75)
                self.assertGreater(sim.offered, offered)
                self.assertEqual(sim.rejected - rejected, sim.offered - offered)
                sim.set_region_online(0, True)
                sim.advance(1.05)
                self.assertGreater(east.running, 0)
                self.check_conservation(sim)

    def test_client_cohorts_fail_over_and_gradually_return_home(self):
        regions, matrix = PRESETS['US · balanced']
        sim = LiveSimulation(regions, matrix, arrival_rate=40, policy='nearest',
                             client_weights=[70, 20, 10], client_migration=True)
        sim.advance(2)
        before = sim.clients.report(40)
        self.assertEqual([row['configured_rps'] for row in before], [28, 8, 4])
        for i, row in enumerate(before):
            self.assertEqual(sum(row['routed_per_second']), row['routed_per_second'][i])

        sim.set_region_online(0, False)
        sim.advance(6)
        east = sim.clients.report(40)[0]
        self.assertEqual((east['shifted_fraction'], east['destination']), (0.6, 1))
        self.assertEqual(east['routed_per_second'][0], 0)
        self.assertGreater(east['routed_per_second'][1], 0)

        sim.set_region_online(0, True)
        sim.advance(15)
        self.assertEqual(sim.clients.report(40)[0]['shifted_fraction'], 0.6)
        sim.advance(19)
        east = sim.clients.report(40)[0]
        self.assertIsNone(east['destination'])
        self.assertGreater(east['routed_per_second'][0], 0)
        self.assertEqual(east['routed_per_second'][1:], [0, 0])
        self.assertEqual([event['shifted_fraction'] for event in sim.clients.changes],
                         [0.2, 0.4, 0.6, 0.4, 0.2, 0])
        self.check_conservation(sim)

    def test_client_failover_keeps_origin_round_trip_time(self):
        regions = [Region(name) for name in ('east', 'west')]
        sim = LiveSimulation(regions, [[5, 200], [300, 10]], arrival_rate=1,
                             service_min=1, service_max=1, client_weights=[1, 0])
        sim.set_region_online(0, False)
        sim.advance(0)
        sim.set_rate(0)
        sim.advance(1.19)
        self.assertEqual(sim.completed, 0)
        sim.advance(1.21)
        self.assertEqual(sim.completed, 1)
        self.assertAlmostEqual(sim.responses[0], 1.2)
        self.assertFalse(sim.clients.changes)
        self.check_conservation(sim)

    def test_sustained_load_shifts_clients_with_home_still_online(self):
        regions = [Region('east', 1, 1), Region('west', 10, 4)]
        sim = LiveSimulation(regions, [[0, 20], [20, 0]], arrival_rate=10,
                             service_min=30, service_max=30,
                             client_weights=[1, 0], client_migration=True)
        sim.advance(2)
        self.assertFalse(sim.clients.changes)
        sim.advance(3)
        self.assertTrue(sim.pools[0].online)
        self.assertEqual(sim.clients.changes[-1]['reason'], 'overload')
        self.assertEqual(sim.clients.report(10)[0]['destination'], 1)
        self.check_conservation(sim)

    def check_conservation(self, sim):
        active = sim.returning + sum(p.running + len(p.waiting) + p.flying for p in sim.pools)
        self.assertEqual(sim.offered, sim.completed + sim.rejected + active)
        for pool in sim.pools:
            self.assertLessEqual(pool.running, pool.region.slots)
            self.assertLessEqual(len(pool.waiting), pool.region.queue_limit)

    def test_large_arrival_windows_exclude_the_cutoff_without_accumulated_drift(self):
        for rate in (1000, 10000):
            with self.subTest(rate=rate):
                sim = LiveSimulation([Region('east', 100, 4)], [[2]],
                                     arrival_rate=rate)
                sim.run_once(100000 / rate)
                self.assertEqual(sim.offered, 100000)
                self.assertEqual(sim.offered, sim.completed + sim.rejected)
                self.check_conservation(sim)

    def test_network_both_directions_and_compute_speed(self):
        sim = LiveSimulation([Region('east', 1, 1, 2)], [[200]],
                             arrival_rate=1, service_min=2, service_max=2)
        sim.advance(0)
        self.assertEqual(sim.pools[0].flying, 1)
        sim.set_rate(0)
        sim.advance(0.1)
        self.assertEqual(sim.pools[0].running, 1)
        sim.advance(1.1)
        self.assertEqual(sim.returning, 1)
        self.assertEqual(sim.completed, 0)
        sim.advance(1.21)
        self.assertEqual(sim.completed, 1)
        self.assertAlmostEqual(sim.responses[0], 1.2)
        self.check_conservation(sim)

    def test_completion_precedes_tied_dispatch(self):
        sim = LiveSimulation([Region('east', 1, 1, 1, 0)], [[0]],
                             arrival_rate=1, service_min=1, service_max=1)
        sim.advance(2)
        self.assertEqual((sim.offered, sim.completed, sim.rejected), (3, 2, 0))
        self.check_conservation(sim)

    def test_queues_reject_and_drain_after_traffic_stops(self):
        sim = LiveSimulation([Region('east', 1, 1, 1, 1)], [[20]],
                             arrival_rate=100, service_min=1, service_max=1)
        sim.advance(0.1)
        self.assertGreater(sim.rejected, 0)
        self.check_conservation(sim)
        sim.set_rate(0)
        sim.advance(5)
        self.assertEqual(sim.offered, sim.completed + sim.rejected)
        self.assertFalse(sim.events)

    def test_chunking_preserves_seeded_results_and_budget_does_not_drop_work(self):
        regions, matrix = PRESETS['US · balanced']
        full = LiveSimulation(regions, matrix, arrival_rate=1000)
        chunked = LiveSimulation(regions, matrix, arrival_rate=1000)
        self.assertFalse(chunked.advance(5, max_events=10))
        self.assertLess(chunked.now, 5)
        while not chunked.advance(5, max_events=200):
            self.check_conservation(chunked)
        full.advance(5)
        self.assertEqual(full.offered, chunked.offered)
        self.assertEqual(full.completed, chunked.completed)
        self.assertEqual(list(full.responses), list(chunked.responses))
        self.assertEqual(full.report(), chunked.report())
        self.check_conservation(full)

    def test_rate_changes_are_relative_to_current_clock(self):
        sim = LiveSimulation([Region('east')], [[0]], arrival_rate=100)
        sim.advance(1)
        count = sim.offered
        sim.set_rate(1)
        sim.advance(1.99)
        self.assertEqual(sim.offered, count)
        sim.advance(2)
        self.assertEqual(sim.offered, count + 1)
        sim.set_rate(0)
        sim.advance(10)
        self.assertEqual(sim.offered, count + 1)
        idle = LiveSimulation([Region('empty')], [[0]], arrival_rate=0)
        idle.advance(10)
        self.assertEqual(idle.offered, 0)

    def test_load_average_and_bounded_retention(self):
        sim = LiveSimulation([Region('east', 1, 1)], [[0]], arrival_rate=1,
                             service_min=100, service_max=100)
        sim.advance(0)
        sim.set_rate(0)
        sim.advance(60)
        sim.report()
        self.assertAlmostEqual(sim.pools[0].load[0], 1 - exp(-1))
        for _ in range(300):
            sim.now += 0.1
            sim.sample()
        self.assertEqual(len(sim.history), 240)
        sim = LiveSimulation([Region('fast', 10, 4, 100)], [[0]], arrival_rate=1000,
                             service_min=.1, service_max=.1)
        sim.advance(5)
        self.assertEqual(len(sim.responses), 2000)
        self.assertEqual(len(sim.pools[0].responses), 2000)
        self.check_conservation(sim)

    def test_nearest_under_load_stays_local_then_spills_over(self):
        regions, matrix = PRESETS['US · balanced']

        def run(policy, rate):
            sim = LiveSimulation(regions, matrix, arrival_rate=rate, policy=policy, seed=42)
            sim.run_once(20)
            self.check_conservation(sim)
            return sim

        # Light traffic fits in the nearest region: identical to nearest.
        light, nearest_light = run('nearest_under_load', 40), run('nearest', 40)
        self.assertEqual([p.completed for p in light.pools], [p.completed for p in nearest_light.pools])
        self.assertEqual(light.response_sum, nearest_light.response_sum)
        self.assertEqual(light.rejected, 0)
        # Heavier traffic: nearest overloads its region; this policy spills over.
        nearest, spill, loaded = (run(p, 130) for p in ('nearest', 'nearest_under_load', 'least_loaded'))
        self.assertGreater(nearest.rejected, 0)
        self.assertEqual(spill.rejected, 0)
        # It keeps more work local and sends less to the far region than least_loaded.
        self.assertGreater(spill.pools[0].completed, loaded.pools[0].completed)
        self.assertLess(spill.pools[2].completed, loaded.pools[2].completed)
        self.assertLess(spill.response_sum / spill.completed, loaded.response_sum / loaded.completed)

    def test_nearest_policy_and_invalid_topology(self):
        sim = LiveSimulation([Region('east'), Region('west')], [[2, 80], [80, 2]],
                             source=1, policy='nearest')
        sim.advance(0.1)
        self.assertEqual(sim.pools[0].running, 0)
        self.assertGreater(sim.pools[1].running, 0)
        with self.assertRaises(ValueError):
            LiveSimulation([Region('duplicate'), Region('duplicate')], [[0, 1], [1, 0]])
        with self.assertRaises(ValueError):
            LiveSimulation([Region('east')], [[-1]])
        with self.assertRaises(ValueError):
            Region('bad', slots_per_server=0)


if __name__ == '__main__':
    unittest.main()
