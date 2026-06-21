import json
from pathlib import Path
from models.question_data import CompetencyMap

_DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "competencies"


def load_competency_map(role_key: str) -> CompetencyMap:
    path = _DATA_DIR / f"{role_key}.json"
    if not path.exists():
        raise FileNotFoundError(f"No competency map for role '{role_key}' at {path}")
    return CompetencyMap.model_validate(json.loads(path.read_text()))
