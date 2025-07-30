import os
from platformdirs import user_data_dir

APP_NAME = "DataSmith"
BASE_PATH = user_data_dir(appname=APP_NAME, appauthor=False)
DB_PATH = os.path.join(BASE_PATH, "config.db")
LOG_PATH = os.path.join(BASE_PATH, "logs")

os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
os.makedirs(LOG_PATH, exist_ok=True)