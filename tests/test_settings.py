import unittest

from lbsim.settings import build_config, validate_config


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.config = dict(server_count=2, concurrency=1, queue_limit=0,
                           arrival_rate=1.0, duration=60.0, service_min=0.1,
                           service_max=1.0, seed=-42, policy="round_robin")

    def test_valid_boundaries_and_copy(self):
        self.config['service_max'] = self.config['service_min']
        result = validate_config(self.config)
        self.assertEqual(result, self.config)
        self.assertIsNot(result, self.config)
        self.assertEqual(build_config(**self.config), result)

    def test_integer_fields(self):
        for field in ('server_count', 'concurrency', 'queue_limit', 'seed'):
            for value in (True, 1.5, '1', None):
                with self.subTest(field=field, value=value):
                    with self.assertRaisesRegex(ValueError, field):
                        validate_config({**self.config, field: value})
        for field, value in (('server_count', 0), ('concurrency', 0), ('queue_limit', -1)):
            with self.assertRaisesRegex(ValueError, field):
                validate_config({**self.config, field: value})

    def test_positive_finite_fields(self):
        for field in ('arrival_rate', 'duration', 'service_min', 'service_max'):
            for value in (0, -1, float('inf'), float('nan'), True, '1', None):
                with self.subTest(field=field, value=value):
                    with self.assertRaisesRegex(ValueError, field):
                        validate_config({**self.config, field: value})

    def test_missing_fields_policy_and_service_bounds(self):
        for field in self.config:
            config = self.config.copy()
            del config[field]
            with self.assertRaisesRegex(ValueError, field):
                validate_config(config)
        with self.assertRaisesRegex(ValueError, 'service_min'):
            validate_config({**self.config, 'service_min': 2})
        with self.assertRaisesRegex(ValueError, 'policy'):
            validate_config({**self.config, 'policy': 'random'})
