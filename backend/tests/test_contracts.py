from models.contracts import (
    IntakeProfile, ProjectHighlight, QuestionPlan, PlannedQuestion,
    AnswerEvaluation, MemoryProfile,
)


def test_intake_profile_camelcase_roundtrip():
    payload = {
        "candidateSkills": ["python", "aws"],
        "yearsExperience": 4.5,
        "projectHighlights": [
            {"title": "Billing", "description": "Rewrote billing", "technologies": ["python"]}
        ],
        "targetRole": "SDE",
        "jdRequirements": ["distributed systems"],
        "resumeToJdGaps": ["no kafka experience"],
    }
    profile = IntakeProfile.model_validate(payload)
    assert profile.years_experience == 4.5
    assert profile.project_highlights[0].title == "Billing"
    assert profile.model_dump(by_alias=True)["candidateSkills"] == ["python", "aws"]


def test_planned_question_difficulty_bounds():
    q = PlannedQuestion(
        id="q1", type="technical", prompt="Explain a deadlock",
        targetDifficulty=3, weightedFromWeakness=False,
    )
    assert q.target_difficulty == 3


def test_answer_evaluation_requires_survival_fields():
    ev = AnswerEvaluation(
        questionId="q1", transcript="...", rubricScores={"depth": 2},
        weaknessTags=["vague-impact"], followUpCount=1,
        wouldSurviveRealInterview=False, survivalReasoning="No concrete metrics given.",
    )
    assert ev.would_survive_real_interview is False
    assert ev.survival_reasoning
