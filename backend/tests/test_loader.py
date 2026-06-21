from models.loader import load_competency_map


def test_load_sde_map():
    cm = load_competency_map("sde")
    assert cm.role == "SDE"
    assert any(c.area.lower().startswith("data structures") for c in cm.competencies)
    assert abs(sum(c.weight for c in cm.competencies) - 1.0) < 0.01


def test_load_ai_engineer_map():
    cm = load_competency_map("ai_engineer")
    assert cm.role == "AI Engineer"
    assert any("ml" in c.area.lower() or "model" in c.area.lower() for c in cm.competencies)
