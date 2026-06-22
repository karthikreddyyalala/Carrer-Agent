"""Text-mode interview loop. Runs a full session in the terminal.

Usage (from backend/ with venv active):
    python -m cli.run_interview --resume path/to/resume.txt --jd path/to/jd.txt --role sde
"""
import argparse
import uuid

from config.settings import Settings
from llm.client import LLMClient
from models.contracts import MemoryProfile
from graph.session_start import build_session_start_graph
from graph.interview_turn import build_interview_turn_graph, InterviewTurnState


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--resume", required=True)
    parser.add_argument("--jd", required=True)
    parser.add_argument("--role", default="sde")
    args = parser.parse_args()

    settings = Settings()
    llm = LLMClient(region=settings.aws_region)

    session_graph = build_session_start_graph(
        llm=llm, intake_model=settings.intake_model, planner_model=settings.planner_model,
    )
    session_result = session_graph.invoke({
        "session_id": str(uuid.uuid4()),
        "resume_text": open(args.resume).read(),
        "jd_text": open(args.jd).read(),
        "role_key": args.role,
        "memory": MemoryProfile(
            candidateId="local-dev", recurringWeaknesses=[], improvementTrend=[], strongAreas=[],
        ),
    })
    plan = session_result["plan"]

    print(f"\n{'='*60}")
    print(f"Interview ready — {len(plan.questions)} questions")
    print(f"{'='*60}\n")

    turn_graph = build_interview_turn_graph(
        llm=llm,
        interviewer_model=settings.planner_model,
        evaluator_model=settings.planner_model,
    )

    state: InterviewTurnState = {
        "plan": plan,
        "current_question_idx": 0,
        "follow_up_count": 0,
        "candidate_answer": "",
        "evaluations": [],
    }

    current_q = plan.questions[0]
    print(f"[Q1/{len(plan.questions)}] {current_q.prompt}\n")

    while True:
        answer = input("You: ").strip()
        if not answer:
            continue

        state["candidate_answer"] = answer
        result = turn_graph.invoke(dict(state))
        state.update(result)

        decision = result["decision"]

        if decision.action == "follow_up":
            print(f"\nInterviewer: {decision.follow_up_prompt}\n")

        elif decision.action in ("advance", "complete"):
            ev = result.get("evaluation")
            if ev:
                survived = "PASS" if ev.would_survive_real_interview else "FAIL"
                print(f"\n[{survived}] {ev.survival_reasoning}")
                scores_str = ", ".join(f"{k}={v}" for k, v in ev.rubric_scores.items())
                print(f"Scores: {scores_str}")
                if ev.weakness_tags:
                    print(f"Weaknesses: {', '.join(ev.weakness_tags)}")
                print()

            if decision.action == "complete" or result.get("session_complete"):
                print(f"\n{'='*60}")
                print("Session complete.")
                all_evals = result.get("evaluations") or []
                passed = sum(1 for e in all_evals if e.would_survive_real_interview)
                print(f"Results: {passed}/{len(all_evals)} answers would survive a real interview.")
                print(f"{'='*60}\n")
                break

            next_idx = result["current_question_idx"]
            if next_idx < len(plan.questions):
                next_q = plan.questions[next_idx]
                print(f"[Q{next_idx + 1}/{len(plan.questions)}] {next_q.prompt}\n")


if __name__ == "__main__":
    main()
