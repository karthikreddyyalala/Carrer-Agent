from pathlib import Path
from models.contracts import IntakeProfile

_PROMPT = (Path(__file__).resolve().parent.parent / "prompts" / "intake.md").read_text()


class IntakeAgent:
    def __init__(self, llm, model: str):
        self._llm = llm
        self._model = model

    def run(self, *, resume_text: str, jd_text: str) -> IntakeProfile:
        user = f"RESUME:\n{resume_text}\n\nJOB DESCRIPTION:\n{jd_text}"
        return self._llm.structured(
            model=self._model, system=_PROMPT, user=user, schema=IntakeProfile,
        )
