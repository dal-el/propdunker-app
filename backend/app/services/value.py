from __future__ import annotations


def implied_prob_decimal(odds: float) -> float:
    # decimal odds
    if odds <= 0:
        return 0.0
    return 1.0 / odds


def value_from_prob(estimated_prob: float, odds: float) -> float:
    return estimated_prob - implied_prob_decimal(odds)
