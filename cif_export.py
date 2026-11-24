"""Idealised cubic-perovskite CIF writer (no pymatgen needed).

    python cif_export.py "La0.6Sr0.4Co0.2Fe0.8O3" -o out/
    python cif_export.py candidates.csv -o cifs/        (columns: composition [, A_elements, B_elements])

What you get: a 5-atom cubic ABO3 cell (Pm-3m arrangement, written in P1 with explicit atoms) with PARTIAL
OCCUPANCY on the A and B sites. The cell edge is estimated from Shannon radii:
    a = ( sqrt(2)*(rA + rO) + 2*(rB + rO) ) / 2       (average of the A-O and B-O contact estimates)
This is a starting structure for DFT / visualisation (VESTA, CrystalMaker, ...). It is NOT relaxed and has no
octahedral tilting, vacancies or real cation ordering. Use pymatgen's OrderDisorderedStructureTransformation or an
SQS tool to make an ordered supercell before running DFT.
"""
import json, os, re, sys, math, argparse
from collections import defaultdict
_HERE = os.path.dirname(os.path.abspath(__file__))
_R = json.load(open(os.path.join(_HERE, "shannon_radii.json")))
R_O = _R["O"]

def parse(formula):
    """Formula -> {element: amount}, oxygen removed. Handles brackets and decimals."""
    s = formula.replace(" ", "")
    def grp(i):
        d = defaultdict(float)
        while i < len(s):
            c = s[i]
            if c == "(":
                sub, i = grp(i + 1)
                m = re.match(r"\d*\.?\d+", s[i:]); f = float(m.group()) if m else 1.0
                if m: i += len(m.group())
                for k, v in sub.items(): d[k] += v * f
            elif c == ")": return d, i + 1
            else:
                m = re.match(r"([A-Z][a-z]?)(\d*\.?\d*)", s[i:])
                if not m: raise ValueError(f"Cannot read formula near '{s[i:]}'")
                d[m.group(1)] += float(m.group(2)) if m.group(2) else 1.0; i += len(m.group())
        return d, i
    d, _ = grp(0); d.pop("O", None); return dict(d)

def radius(el, site):
    other = "B" if site == "A" else "A"
    if el in _R[site]: return _R[site][el], False
    if el in _R[other]: return _R[other][el], True      # fallback: radius listed for the other site only
    raise KeyError(el)

def assign_sites(comp, a_elems=None, b_elems=None):
    """Return (A, B) dicts normalised to 1 per site. Uses the supplied element lists if given, else a radius rule."""
    if a_elems:
        A = {e: comp[e] for e in comp if e in a_elems}; B = {e: comp[e] for e in comp if e not in a_elems}
    else:
        A = {e: v for e, v in comp.items() if e in _R["A"] and (e not in _R["B"] or _R["A"][e] >= 1.0)}
        B = {e: v for e, v in comp.items() if e not in A}
    if not A or not B: raise ValueError("could not split into A and B sites")
    na, nb = sum(A.values()), sum(B.values())
    return {e: v / na for e, v in A.items()}, {e: v / nb for e, v in B.items()}

def build_cif(A, B, label="perovskite", notes=()):
    fallback = []
    def mean_r(site, d):
        t = 0.0
        for e, f in d.items():
            r, fb = radius(e, site); t += f * r
            if fb: fallback.append(f"{e} ({site}-site radius taken from the {'B' if site=='A' else 'A'}-site column)")
        return t
    rA, rB = mean_r("A", A), mean_r("B", B)
    a = (math.sqrt(2) * (rA + R_O) + 2 * (rB + R_O)) / 2
    t = (rA + R_O) / (math.sqrt(2) * (rB + R_O))
    L = ["# Idealised cubic perovskite (NOT relaxed). Cell edge estimated from Shannon radii.",
         f"# mean r(A)={rA:.3f} A, mean r(B)={rB:.3f} A, tolerance factor t={t:.3f}"]
    L += [f"# {n}" for n in notes]
    L += [f"# radius fallback: {f}" for f in sorted(set(fallback))]
    if not 0.8 <= t <= 1.06: L.append("# WARNING: tolerance factor outside 0.8-1.06; a cubic perovskite is unlikely to be stable")
    L += [f"data_{re.sub(r'[^A-Za-z0-9_.-]', '_', label)}",
          f"_cell_length_a {a:.4f}", f"_cell_length_b {a:.4f}", f"_cell_length_c {a:.4f}",
          "_cell_angle_alpha 90.0", "_cell_angle_beta 90.0", "_cell_angle_gamma 90.0", f"_cell_volume {a**3:.4f}",
          "_symmetry_space_group_name_H-M 'P 1'", "_symmetry_Int_Tables_number 1",
          "loop_", "_symmetry_equiv_pos_as_xyz", "  'x, y, z'",
          "loop_", "_atom_site_label", "_atom_site_type_symbol", "_atom_site_fract_x", "_atom_site_fract_y",
          "_atom_site_fract_z", "_atom_site_occupancy"]
    for e, f in A.items(): L.append(f"{e}_A {e} 0.0000 0.0000 0.0000 {f:.4f}")
    for e, f in B.items(): L.append(f"{e}_B {e} 0.5000 0.5000 0.5000 {f:.4f}")
    for i, (x, y, z) in enumerate([(0.5, 0.5, 0.0), (0.5, 0.0, 0.5), (0.0, 0.5, 0.5)], 1):
        L.append(f"O{i} O {x:.4f} {y:.4f} {z:.4f} 1.0000")
    return "\n".join(L) + "\n", {"a": a, "t": t, "rA": rA, "rB": rB, "fallback": sorted(set(fallback))}

def cif_from_formula(formula, a_elems=None, b_elems=None, notes=()):
    A, B = assign_sites(parse(formula), a_elems)
    return build_cif(A, B, label=formula, notes=notes)

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("src"); ap.add_argument("-o", default="cifs")
    a = ap.parse_args(); os.makedirs(a.o, exist_ok=True)
    if a.src.endswith(".csv"):
        import pandas as pd
        for r in pd.read_csv(a.src).to_dict("records"):
            try:
                ae = set(str(r["A_elements"]).split(",")) if r.get("A_elements") else None
                text, info = cif_from_formula(r["composition"], ae)
                open(os.path.join(a.o, re.sub(r"[^A-Za-z0-9_.-]", "_", r["composition"]) + ".cif"), "w").write(text)
            except Exception as ex: print("skipped", r["composition"], ex)
    else:
        text, info = cif_from_formula(a.src)
        open(os.path.join(a.o, re.sub(r"[^A-Za-z0-9_.-]", "_", a.src) + ".cif"), "w").write(text); print(text)
