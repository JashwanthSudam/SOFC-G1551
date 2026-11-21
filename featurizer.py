"""Turn a perovskite formula (name only) into model inputs.
Uses elements.json (per-element descriptors for A-site and B-site)."""
import json, re, os
_HERE = os.path.dirname(os.path.abspath(__file__))
_E = json.load(open(os.path.join(_HERE, "elements.json")))
A_EL, B_EL, KNOWN = _E["A"], _E["B"], _E["known"]
B_FORCED = {"Y", "Zr"}          # always B-site when they appear
R_O = 1.40                      # oxide ion radius (Angstrom)

def _parse(s):
    s = s.replace(" ", "")
    def grp(i):
        d = {}
        while i < len(s):
            c = s[i]
            if c == "(":
                sub, i = grp(i + 1)               # i is after ')'
                m = re.match(r"\d*\.?\d+", s[i:])
                f = float(m.group()) if m else 1.0
                if m: i += len(m.group())
                for k, v in sub.items(): d[k] = d.get(k, 0) + v * f
            elif c == ")":
                return d, i + 1
            else:
                m = re.match(r"([A-Z][a-z]?)(\d*\.?\d*)", s[i:])
                if not m: raise ValueError(f"Cannot read formula near '{s[i:]}'")
                n = float(m.group(2)) if m.group(2) else 1.0
                d[m.group(1)] = d.get(m.group(1), 0) + n
                i += len(m.group())
        return d, i
    d, _ = grp(0)
    d.pop("O", None)
    return d

def split_sites(name):
    comp = _parse(name)
    k = KNOWN.get(name)
    if k:  # site assignment known from the dataset
        def p(t): return {x.split()[0]: float(x.split()[1]) if len(x.split()) > 1 else 1.0 for x in t.split(",")} if False else None
        A = {e for e in re.findall(r"[A-Z][a-z]?", k["A"])}
        B = {e for e in re.findall(r"[A-Z][a-z]?", k["B"])}
    else:
        A = {e for e in comp if e in A_EL and e not in B_FORCED}
        B = {e for e in comp if e not in A}
    unknown = [e for e in comp if e not in A_EL and e not in B_EL]
    if unknown: raise ValueError(f"Unsupported element(s): {unknown}")
    a = {e: comp[e] for e in comp if e in A}
    b = {e: comp[e] for e in comp if e in B}
    if not a or not b: raise ValueError("Need both A-site and B-site elements")
    return a, b

def _avg(site, table, key):
    tot = sum(site.values())
    return sum(n * table[e][key] for e, n in site.items()) / tot

def featurize(name):
    a, b = split_sites(name)
    f = {}
    for key, out in [("Ion","Ion"),("EN","EN"),("R","R"),("Sa","Sa"),("SmithAcid","SmithAcid"),("Ionic","Ionic")]:
        f[f"{out}_A"] = _avg(a, A_EL, key)
        f[f"{out}_B"] = _avg(b, B_EL, key)
    f["Delec_B"] = _avg(b, B_EL, "Delec")
    f["t"] = (f["R_A"] + R_O) / (2 ** 0.5 * (f["R_B"] + R_O))
    f["Avg_Ionic_Character"] = (f["Ionic_A"] + f["Ionic_B"]) / 2
    # whole-formula averages used by ASR / TEC / conductivity models
    na, nb = sum(a.values()), sum(b.values())
    for key in ["Ion","EN","R","Sa","SmithAcid","Ionic"]:
        f[f"avg_{key}"] = (na * f[f"{key}_A"] + nb * f[f"{key}_B"]) / (na + nb)
    return f
