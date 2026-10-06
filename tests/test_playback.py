import unittest
from pathlib import Path
from streamlit.testing.v1 import AppTest
from lbsim.playback import Playback
from lbsim.simulation import run_simulation

CONFIG = dict(server_count=1, concurrency=1, queue_limit=1, arrival_rate=4.0,
              duration=1.0, service_min=1.0, service_max=1.0, seed=42, policy='round_robin')


class PlaybackTests(unittest.TestCase):
    def test_overload_queue_drain_and_backward_seek(self):
        summary = run_simulation(CONFIG)
        replay = Playback(summary['events'], 1)
        replay.advance(0)
        self.assertEqual(replay.servers, {0: (1, 0)})
        replay.advance(0.25)
        self.assertEqual(replay.servers, {0: (1, 1)})
        replay.advance(0.75)
        self.assertEqual(replay.rejected, 2)
        replay.advance(1)
        self.assertEqual(replay.servers, {0: (1, 0)})
        self.assertEqual(replay.completed, 1)
        replay.advance(2)
        self.assertEqual(replay.servers, {0: (0, 0)})
        self.assertEqual(replay.completed, summary['completed_count'])
        self.assertEqual(replay.rejected, summary['rejected_count'])
        replay.advance(0.25)
        self.assertEqual(replay.servers, {0: (1, 1)})
        self.assertEqual((replay.completed, replay.rejected), (0, 0))

    def test_tied_completion_precedes_arrival_and_empty_run(self):
        summary = run_simulation({**CONFIG, 'arrival_rate': 1.0, 'duration': 2.0, 'queue_limit': 0})
        tied = [e[4] for e in summary['events'] if e[0] == 1]
        self.assertEqual(tied, ['completed', 'started'])
        replay = Playback(summary['events'], 1).advance(2)
        self.assertEqual((replay.completed, replay.rejected), (2, 0))
        empty = Playback([], 2).advance(10)
        self.assertEqual(empty.servers, {0: (0, 0), 1: (0, 0)})

    def test_controls_seek_restart_and_new_run(self):
        app = AppTest.from_file(str(Path(__file__).resolve().parents[1] / 'src/lbsim/app.py')).run()
        for key, value in CONFIG.items():
            if key != 'policy':
                app.number_input(key=key).set_value(value)
        next(b for b in app.button if b.label == 'Run simulation').click().run()
        self.assertFalse(app.exception)
        app.slider(key='playback_seek').set_value(0.5).run()
        self.assertEqual(app.session_state['playback_engine'].rejected, 1)
        next(b for b in app.button if b.label == 'Play').click().run()
        self.assertTrue(app.session_state['playback_playing'])
        next(b for b in app.button if b.label == 'Pause').click().run()
        self.assertFalse(app.session_state['playback_playing'])
        next(b for b in app.button if b.label == 'Restart').click().run()
        self.assertEqual(app.session_state['playback_time'], 0)
        app.slider(key='playback_seek').set_value(2.0).run()
        self.assertEqual(app.session_state['playback_engine'].completed, 2)
        app.number_input(key='server_count').set_value(2)
        next(b for b in app.button if b.label == 'Run simulation').click().run()
        self.assertFalse(app.exception)
        self.assertEqual(app.session_state['playback_time'], 0)
        self.assertEqual(len(app.session_state['playback_engine'].servers), 2)
