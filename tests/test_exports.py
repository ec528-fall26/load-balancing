import csv
from copy import deepcopy
from io import StringIO
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from streamlit.testing.v1 import AppTest

from lbsim.exports import build_exports
from lbsim.simulation import run_simulation

CONFIG = dict(server_count=1, concurrency=1, queue_limit=1, arrival_rate=4.0,
              duration=1.0, service_min=1.0, service_max=1.0, seed=-42,
              policy="round_robin")
APP = Path(__file__).resolve().parents[1] / "src/lbsim/app.py"


def rows(export):
    return list(csv.DictReader(StringIO(export.results_csv.decode("utf-8"))))


class ExportTests(unittest.TestCase):
    def test_real_overload_export_and_config_reproduction(self):
        summary = run_simulation(CONFIG)
        original = deepcopy(summary)
        export = build_exports(CONFIG, summary)
        document = json.loads(export.config_json)
        self.assertEqual(document["schema_version"], 1)
        self.assertEqual(document["config"], CONFIG)
        self.assertEqual(document["run_id"], export.run_id)
        self.assertEqual(run_simulation(document["config"]), summary)
        row, = rows(export)
        self.assertEqual(row["run_id"], export.run_id)
        self.assertEqual(row["schema_version"], "1")
        self.assertEqual(row["seed"], "-42")
        self.assertEqual(row["policy"], "round_robin")
        self.assertEqual((row["generated_count"], row["completed_count"], row["rejected_count"]),
                         ("4", "2", "2"))
        self.assertEqual(float(row["mean_response_time_seconds"]), 1.375)
        self.assertEqual(float(row["p95_response_time_seconds"]), 1.75)
        self.assertEqual(float(row["slot_utilization"]), 1.0)
        self.assertEqual(summary, original)
        self.assertEqual(build_exports(CONFIG, summary), export)

    def test_least_active_export_preserves_policy_and_reproduces_results(self):
        config = {**CONFIG, "server_count": 3, "policy": "least_active_requests"}
        summary = run_simulation(config)
        export = build_exports(config, summary)
        restored = json.loads(export.config_json)["config"]
        self.assertEqual(restored, config)
        self.assertEqual(run_simulation(restored), summary)
        exported = rows(export)
        self.assertEqual(len(exported), 3)
        for row in exported:
            self.assertEqual(row["policy"], "least_active_requests")
            self.assertEqual(float(row["slot_utilization"]),
                             summary["per_server_utilization"][int(row["server_id"])])

    def test_idle_servers_empty_run_and_unrounded_values(self):
        for rate, duration in ((0.1, 1.0), (1.0, 2.0)):
            config = {**CONFIG, "server_count": 4, "arrival_rate": rate,
                      "duration": duration, "service_min": 0.123456789,
                      "service_max": 0.123456789}
            summary = run_simulation(config)
            exported = rows(build_exports(config, summary))
            self.assertEqual([int(row["server_id"]) for row in exported], list(range(4)))
            for row in exported:
                sid = int(row["server_id"])
                self.assertEqual(float(row["slot_utilization"]), summary["per_server_utilization"][sid])
                if summary["completed_count"]:
                    self.assertEqual(float(row["mean_response_time_seconds"]), summary["mean_response_time"])
                else:
                    self.assertEqual(row["mean_response_time_seconds"], "")
                    self.assertEqual(row["p95_response_time_seconds"], "")
                    self.assertEqual(row["generated_count"], "0")

    def test_ui_exports_completed_config_and_clears_after_invalid_run(self):
        app = AppTest.from_file(str(APP), default_timeout=30).run()
        self.assertFalse(app.get("download_button"))
        for key, value in CONFIG.items():
            if key != "policy":
                app.number_input(key=key).set_value(value)
        next(b for b in app.button if b.label == "Run simulation").click().run()
        self.assertFalse(app.exception)
        self.assertEqual(len(app.get("download_button")), 2)
        with patch("lbsim.exports.build_exports", wraps=build_exports) as build:
            app.number_input(key="server_count").set_value(3).run()
            self.assertFalse(app.exception)
            self.assertEqual(build.call_args.args[0], CONFIG)
        app.number_input(key="server_count").set_value(3)
        next(b for b in app.button if b.label == "Run simulation").click().run()
        self.assertFalse(app.exception)
        self.assertEqual(app.session_state["config"]["server_count"], 3)
        app.number_input(key="duration").set_value(-1.0)
        next(b for b in app.button if b.label == "Run simulation").click().run()
        self.assertFalse(app.exception)
        self.assertTrue(app.error)
        self.assertFalse(app.get("download_button"))
