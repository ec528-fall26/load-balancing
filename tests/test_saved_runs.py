import csv
from io import StringIO
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from streamlit.testing.v1 import AppTest

from lbsim.exports import build_exports, CSV_FIELDS
from lbsim.saved_runs import (MAX_FILE_BYTES, load_configuration, load_results,
                             replay_configuration)
from lbsim.simulation import run_simulation

CONFIG = dict(server_count=2, concurrency=1, queue_limit=1, arrival_rate=8.0,
              duration=1.0, service_min=0.25, service_max=1.0, seed=-42,
              policy="round_robin")
APP = Path(__file__).resolve().parents[1] / "src/lbsim/app.py"


def export(config=None):
    config = CONFIG if config is None else config
    summary = run_simulation(config)
    return build_exports(config, summary), summary


def changed_csv(data, change):
    rows = list(csv.DictReader(StringIO(data.decode("utf-8"))))
    change(rows)
    result = StringIO(newline="")
    writer = csv.DictWriter(result, fieldnames=CSV_FIELDS)
    writer.writeheader()
    writer.writerows(rows)
    return result.getvalue().encode("utf-8")


class Upload:
    def __init__(self, data):
        self.data = data

    def getvalue(self):
        return self.data


class SavedRunTests(unittest.TestCase):
    def test_both_policies_round_trip_and_replay_full_event_history(self):
        for policy in ("round_robin", "least_active_requests"):
            for rate in (0.1, 8.0):
                with self.subTest(policy=policy, rate=rate):
                    config = {**CONFIG, "policy": policy, "arrival_rate": rate}
                    files, summary = export(config)
                    saved = load_configuration(files.config_json)
                    self.assertEqual(saved.config, config)
                    self.assertEqual(replay_configuration(saved), summary)
                    results = load_results(files.results_csv)
                    self.assertEqual(results.config, config)
                    self.assertEqual(results.run_id, files.run_id)
                    for key, value in results.summary.items():
                        self.assertEqual(value, summary[key])

    def test_integer_config_numbers_bom_and_reordered_server_rows(self):
        config = {**CONFIG, "arrival_rate": 8, "duration": 1,
                  "service_min": 1, "service_max": 1}
        files, summary = export(config)
        saved = load_configuration(b"\xef\xbb\xbf" + files.config_json)
        self.assertEqual(replay_configuration(saved), summary)
        reversed_rows = changed_csv(files.results_csv, lambda rows: rows.reverse())
        loaded = load_results(b"\xef\xbb\xbf" + reversed_rows)
        self.assertEqual(loaded.run_id, files.run_id)
        self.assertEqual(loaded.config, config)

    def test_config_rejects_malformed_versions_and_invalid_settings(self):
        files, _ = export()
        document = json.loads(files.config_json)
        cases = [b"{", b"[]", b"\xff", b"{}", b'{"config":{},"config":{}}',
                 b"x" * (MAX_FILE_BYTES + 1)]
        for version in (True, "1", 2):
            cases.append(json.dumps({**document, "schema_version": version}).encode())
        for change in ({"server_count": 0}, {"policy": "unknown"},
                       {"seed": 1.5}, {"service_min": 2.0, "service_max": 1.0},
                       {"duration": float("inf")}, {"duration": 10**400}):
            cases.append(json.dumps({**document, "config": {**CONFIG, **change}}).encode())
        cases.extend([json.dumps({**document, "run_id": "bad"}).encode(),
                      json.dumps({**document, "config": {**CONFIG, "unexpected": 1}}).encode()])
        for data in cases:
            with self.subTest(data=data[:80]), self.assertRaises(ValueError):
                load_configuration(data)

    def test_modified_configuration_fails_replay_fingerprint(self):
        files, _ = export()
        document = json.loads(files.config_json)
        document["config"]["seed"] = 5
        saved = load_configuration(json.dumps(document).encode())
        with self.assertRaisesRegex(ValueError, "did not match"):
            replay_configuration(saved)

    def test_csv_rejects_corrupt_rows_counts_and_fingerprint(self):
        files, _ = export()
        mutations = [
            lambda rows: rows.pop(),
            lambda rows: rows[1].update(server_id=rows[0]["server_id"]),
            lambda rows: rows[0].update(server_id="20"),
            lambda rows: rows[0].update(seed="3"),
            lambda rows: [row.update(schema_version="2") for row in rows],
            lambda rows: [row.update(completed_count="-1") for row in rows],
            lambda rows: [row.update(generated_count="999") for row in rows],
            lambda rows: [row.update(mean_response_time_seconds="NaN") for row in rows],
            lambda rows: rows[0].update(slot_utilization="1.1"),
            lambda rows: rows[0].update(slot_utilization="-0.1"),
            lambda rows: rows[0].update(slot_utilization="0.123456"),
            lambda rows: [row.update(run_id="a" * 64) for row in rows],
        ]
        for index, mutation in enumerate(mutations):
            with self.subTest(index=index), self.assertRaises(ValueError):
                load_results(changed_csv(files.results_csv, mutation))
        for data in (b"", b"wrong,header\n1,2\n", b"\xff",
                     files.results_csv.splitlines()[0] + b"\n",
                     files.results_csv + b"1,2,3\n",
                     b"x" * (MAX_FILE_BYTES + 1)):
            with self.subTest(data=data[:80]), self.assertRaises(ValueError):
                load_results(data)

    def test_empty_run_requires_blank_latency_and_preserves_idle_servers(self):
        files, _ = export({**CONFIG, "arrival_rate": 0.1})
        saved = load_results(files.results_csv)
        self.assertIsNone(saved.summary["mean_response_time"])
        self.assertEqual(saved.summary["per_server_utilization"], {0: 0.0, 1: 0.0})
        bad = changed_csv(files.results_csv, lambda rows: [
            row.update(mean_response_time_seconds="0") for row in rows])
        with self.assertRaisesRegex(ValueError, "blank"):
            load_results(bad)


class SavedRunAppTests(unittest.TestCase):
    def test_replay_uses_saved_config_and_resets_playback(self):
        files, original = export()
        def upload(label, **kwargs):
            return Upload(files.config_json) if kwargs.get("key") == "saved_config_upload" else None
        with patch("streamlit.file_uploader", side_effect=upload):
            app = AppTest.from_file(str(APP), default_timeout=30).run()
            self.assertFalse(app.exception)
            next(b for b in app.button if b.label == "Replay saved configuration").click().run()
            self.assertFalse(app.exception)
            self.assertTrue(app.success)
            self.assertEqual(app.session_state["config"], CONFIG)
            self.assertEqual(app.session_state["summary"], original)
            app.slider(key="playback_seek").set_value(0.5).run()
            next(b for b in app.button if b.label == "Replay saved configuration").click().run()
            self.assertEqual(app.session_state["playback_time"], 0)
            self.assertFalse(app.session_state["playback_playing"])

    def test_bad_replay_preserves_current_results_and_bad_json_has_no_replay_button(self):
        app = AppTest.from_file(str(APP), default_timeout=30).run()
        next(b for b in app.button if b.label == "Run simulation").click().run()
        original = app.session_state["summary"]
        files, _ = export()
        document = json.loads(files.config_json)
        document["run_id"] = "0" * 64
        data = json.dumps(document).encode()
        def upload(label, **kwargs):
            return Upload(data) if kwargs.get("key") == "saved_config_upload" else None
        with patch("streamlit.file_uploader", side_effect=upload):
            app.run()
            next(b for b in app.button if b.label == "Replay saved configuration").click().run()
            self.assertFalse(app.exception)
            self.assertTrue(any("did not match" in error.value for error in app.error))
            self.assertEqual(app.session_state["summary"], original)
            data = b"malformed json"
            app.run()
            self.assertTrue(app.error)
            self.assertFalse(any(b.label == "Replay saved configuration" for b in app.button))
            self.assertEqual(app.session_state["summary"], original)

    def test_comparison_shows_metrics_policies_settings_and_no_simulation(self):
        a, _ = export()
        b, _ = export({**CONFIG, "policy": "least_active_requests", "seed": 7})
        uploads = {"compare_a": a.results_csv, "compare_b": b.results_csv}
        def upload(label, **kwargs):
            data = uploads.get(kwargs.get("key"))
            return Upload(data) if data is not None else None
        with patch("streamlit.file_uploader", side_effect=upload), \
             patch("lbsim.saved_runs.run_simulation", side_effect=AssertionError("Unexpected replay")):
            app = AppTest.from_file(str(APP), default_timeout=30).run()
            self.assertFalse(app.exception)
            self.assertEqual(len(app.metric), 8)
            self.assertTrue(any("seed" in warning.value for warning in app.warning))
            self.assertTrue(any("round_robin" in item.value for item in app.markdown))
            self.assertTrue(any("least_active_requests" in item.value for item in app.markdown))
            table = app.table[0].value
            self.assertIn("seed", table["Setting"].tolist())
            self.assertEqual(len(app.dataframe), 2)
            uploads["compare_b"] = b"broken"
            app.run()
            self.assertFalse(app.exception)
            self.assertTrue(app.error)
            self.assertEqual(len(app.metric), 0)
            del uploads["compare_b"]
            app.run()
            self.assertFalse(app.error)
            self.assertEqual(len(app.metric), 0)

    def test_empty_comparison_has_na_latency_and_rejection(self):
        files, _ = export({**CONFIG, "arrival_rate": 0.1})
        def upload(label, **kwargs):
            return Upload(files.results_csv) if kwargs.get("key") in ("compare_a", "compare_b") else None
        with patch("streamlit.file_uploader", side_effect=upload):
            app = AppTest.from_file(str(APP), default_timeout=30).run()
            self.assertFalse(app.exception)
            self.assertEqual([metric.value for metric in app.metric],
                             ["N/A", "N/A", "N/A", "0.0%"] * 2)
