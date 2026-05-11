#!/usr/bin/env python3
"""Analyze battery specimens CSV and find leader by energy density."""
import csv
from pathlib import Path

def main():
    csv_path = Path(__file__).parent.parent / "data" / "battery_specimens.csv"
    rows = []
    with open(csv_path, "r") as f:
        reader = csv.DictReader(f)
        for row in reader:
            row["energy_density_wh_kg"] = int(row["energy_density_wh_kg"])
            rows.append(row)

    # Sort by energy density descending
    rows.sort(key=lambda r: r["energy_density_wh_kg"], reverse=True)

    print("=== Battery Specimen Analysis ===")
    print(f"Total manufacturers: {len(rows)}")
    print()
    print("By energy density (highest first):")
    for i, row in enumerate(rows, 1):
        print(f"{i}. {row['manufacturer']} — {row['energy_density_wh_kg']} Wh/kg")
        print(f"   Chemistry: {row['chemistry']}")
        print(f"   Prototype: {row['prototype_year']}, Commercial: {row['commercial_target_year']}")
        print(f"   Status: {row['status']}")
        print()

    leader = rows[0]
    print(f"Leader: {leader['manufacturer']} at {leader['energy_density_wh_kg']} Wh/kg")
    print(f"But commercial target is {leader['commercial_target_year']}, not guaranteed.")

if __name__ == "__main__":
    main()
