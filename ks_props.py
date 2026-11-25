"""Physics-informed property estimators (NOT trained on measured data).
Chain: k*(T) [ML, trained] -> D* -> sigma_ion (Nernst-Einstein) ; Gap -> sigma_e (small-polaron) ;
Adler-Lane-Steele (ALS) model -> polarization resistance Rp ; ASR = Rp + electronic ohmic term.
All constants are documented assumptions; use for RELATIVE ranking and low-T retention, not absolute design values."""
import numpy as np
R, F, KB = 8.314, 96485.0, 8.617e-5
CO = 0.087          # mol O / cm3 (3 O per ~57 A^3 cell)
LC0 = 5e-3          # cm, characteristic thickness D*/k* of the reference perovskite (50 um)
TAU, EPS, AV = 3.0, 0.30, 8.4e4   # tortuosity, porosity, surface area per volume (1/cm)
import os
R_OHM_EXTRA = float(os.environ.get('ASR_R_OHM_EXTRA', '0.0'))  # electrolyte + contacts, ohm cm2
THK = 1e-3          # cm, 10 um cathode functional layer
A_E = 2.2e6         # S K/cm, anchors sigma_e ~1500 S/cm at 800 C for a gapless (metallic-like) perovskite

def properties(logk, T_C, gap, evac, evac_ref):
    T = np.asarray(T_C, float) + 273.15
    k = 10.0 ** np.clip(np.asarray(logk, float), -12.0, -3.0)
    fv = np.clip(np.exp(-(np.asarray(evac, float) - evac_ref) / (2 * KB * T)), 0.2, 5.0)   # vacancy-availability factor
    D = k * LC0 * fv
    sig_i = 4 * F**2 * CO * D / (R * T)
    ea = 0.03 + 0.20 * np.clip(np.asarray(gap, float) - 1.0, 0, None)
    sig_e = (A_E / T) * np.exp(-ea / (KB * T))
    rp = (R * T / (4 * F**2)) * np.sqrt(TAU / ((1 - EPS) * AV * CO**2 * D * k))
    asr = rp + THK * TAU / ((1 - EPS) * sig_e) + R_OHM_EXTRA
    return {'sigma_i': sig_i, 'sigma_e': sig_e, 'rp': rp, 'asr': asr, 'D': D}


def asr_from(rp, sigma_e):
    """ASR with a different electronic conductivity (e.g. the ML conductivity model): Rp + ohmic loss of the film."""
    rp = np.asarray(rp, float); se = np.asarray(sigma_e, float)
    return rp + THK * TAU / ((1 - EPS) * se) + R_OHM_EXTRA
