"""Extra properties shown on the Predict page, derived from the k* prediction.

ML      = predicted by a trained model in this project (k*, conductivity, TEC, E above hull).
Physics = worked out from log k* with the textbook formulas below. These are relative-ranking
          estimates, not measurements. Constants are editable with environment variables.
"""
import itertools
import math
import os

R = 8.314462618       # J / (mol K)
F = 96485.33212       # C / mol
C_O = float(os.environ.get("C_O_MOL_CM3", "0.083"))        # lattice oxygen concentration, mol/cm3 (ABO3)
CHAR_LEN = float(os.environ.get("CHAR_LENGTH_CM", "0.01"))  # Lc = D*/k*, cm (about 100 um for mixed conductors)
FILM_CM = float(os.environ.get("CATHODE_FILM_CM", "0.001")) # 10 um cathode layer, for the ohmic part of ASR
# Extra series ohmic resistance (electrolyte + contacts), ohm cm2. Without this, ASR ~ Rp because a 10 um film adds <1e-3 ohm cm2.
R_OHM_EXTRA = float(os.environ.get("ASR_R_OHM_EXTRA", "0.0"))
SIGMA_E_FALLBACK = float(os.environ.get("SIGMA_E_FALLBACK_S_CM", "10"))  # used only if no conductivity is available
LSC_FORMULA = os.environ.get("LSC_FORMULA", "La0.6Sr0.4CoO3")
LOW_T_MAX = 700  # deg C; "low-temperature operation" at or below this

# Indicative raw-material prices, USD per kg of element. Rough and for ranking only: edit freely.
PRICE_USD_PER_KG = {
    "La": 5, "Sr": 8, "Ba": 3, "Ca": 3, "Pr": 90, "Nd": 80, "Sm": 25, "Gd": 60, "Dy": 350,
    "Co": 33, "Fe": 0.6, "Mn": 2.5, "Ni": 17, "Cr": 10, "Al": 2.5, "Ga": 280, "Mg": 3,
    "Sc": 3500, "Ti": 6, "Y": 40, "Zr": 35,
}
ATOMIC_MASS = {
    "La": 138.905, "Sr": 87.62, "Ba": 137.327, "Ca": 40.078, "Pr": 140.908, "Nd": 144.242, "Sm": 150.36,
    "Gd": 157.25, "Dy": 162.5, "Co": 58.933, "Fe": 55.845, "Mn": 54.938, "Ni": 58.693, "Cr": 51.996,
    "Al": 26.982, "Ga": 69.723, "Mg": 24.305, "Sc": 44.956, "Ti": 47.867, "Y": 88.906, "Zr": 91.224,
}
M_OXYGEN = 15.999


def tk(temp_c):
    return float(temp_c) + 273.15


def sigma_ionic(log_k, temp_c):
    """Nernst-Einstein: sigma_i = 4 F^2 c_O D / (R T), with D* = k* x Lc.  S/cm."""
    D = (10.0 ** log_k) * CHAR_LEN
    return 4 * F * F * C_O * D / (R * tk(temp_c))


def r_polarization(log_k, temp_c):
    """Surface-exchange-limited polarization resistance (Adler): Rp = R T / (4 F^2 c_O k*).  ohm cm2."""
    return R * tk(temp_c) / (4 * F * F * C_O * (10.0 ** log_k))


def ohmic_parts(sigma_e):
    """(film ohmic, extra series ohmic) in ohm cm2. Never silently zero: falls back to SIGMA_E_FALLBACK."""
    se = sigma_e if sigma_e and sigma_e > 0 else SIGMA_E_FALLBACK
    return FILM_CM / se, R_OHM_EXTRA


def asr_total(rp, sigma_e):
    """ASR = Rp + film ohmic loss + extra series ohmic (R_OHM_EXTRA)."""
    film, extra = ohmic_parts(sigma_e)
    return rp + film + extra


def price_per_kg(frac_A, frac_B):
    """Mass-weighted raw-material price of one formula unit (oxygen counted as free)."""
    tot_m = M_OXYGEN * 3
    cost = 0.0
    for fr in (frac_A, frac_B):
        for el, f in fr.items():
            m = ATOMIC_MASS.get(el)
            if m is None or el not in PRICE_USD_PER_KG:
                return None
            tot_m += f * m
            cost += f * m * PRICE_USD_PER_KG[el]
    return cost / tot_m


def stability_band(ehull, limit):
    if ehull <= limit:
        return "Stable"
    if ehull <= 100:
        return "Moderate stability"
    return "Low stability"


def rating(delta):
    if delta >= 1.0:
        return "Excellent"
    if delta >= 0.0:
        return "Good"
    if delta >= -0.5:
        return "Comparable"
    return "Below LSC"


def versus(value, ref, higher_is_better):
    """Factor and direction against the LSC reference, e.g. 'x776 higher than LSC'."""
    if not value or not ref or value <= 0 or ref <= 0:
        return None
    ratio = value / ref
    up = ratio >= 1
    f = ratio if up else 1 / ratio
    return {"factor": round(f, 1), "up": up, "good": (up == higher_is_better)}


# ---------------------------------------------------------------- candidate library for the finders
LN = ["La", "Pr", "Nd", "Sm", "Gd"]
AE = ["Sr", "Ba", "Ca"]
X_FR = [0.2, 0.4, 0.5, 0.6, 0.8]
B_EL = ["Co", "Fe", "Mn", "Ni"]


def _num(x):
    return f"{x:.2f}".rstrip("0").rstrip(".")


def library():
    """A few thousand ABO3 compositions built from elements the model knows."""
    out = []
    bs = [f"{b}1" for b in B_EL]
    for b1, b2 in itertools.combinations(B_EL, 2):
        for y in X_FR:
            bs.append(f"{b1}{_num(y)}{b2}{_num(1 - y)}")
    for ln, ae, x in itertools.product(LN, AE, X_FR):
        a = f"{ln}{_num(1 - x)}{ae}{_num(x)}"
        for b in bs:
            b = b.replace("1", "") if b.count("1") == 1 and len(b) == 3 else b
            out.append(f"{a}{b}O3")
    return out
