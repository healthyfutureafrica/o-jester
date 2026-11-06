import os
import tempfile

# Test configuration — must be set before the app modules are imported.
_tmp = tempfile.mkdtemp(prefix="ojester-test-")
os.environ.update(
    {
        "APP_ENV": "test",
        "SECRET_KEY": "test-secret-key-test-secret-key-test-secret",
        "FOOTBALL_PROVIDER": "football-data",
        "FOOTBALL_DATA_KEY": "test-key-not-used",
        "DATABASE_URL": f"sqlite:///{_tmp}/test.db",
        "ENABLE_SCHEDULER": "false",
        "PAYMENTS_SANDBOX": "true",
        "ANTHROPIC_API_KEY": "",
    }
)
