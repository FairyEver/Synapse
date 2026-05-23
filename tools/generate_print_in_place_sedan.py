#!/usr/bin/env python3
"""Generate a small print-in-place sedan STL with captive rolling wheels."""

from __future__ import annotations

import math
import struct
from pathlib import Path


Vec3 = tuple[float, float, float]
Face = tuple[Vec3, Vec3, Vec3]


faces: list[Face] = []


def add_face(a: Vec3, b: Vec3, c: Vec3) -> None:
    faces.append((a, b, c))


def add_quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3) -> None:
    add_face(a, b, c)
    add_face(a, c, d)


def add_box(x1: float, x2: float, y1: float, y2: float, z1: float, z2: float) -> None:
    v = {
        "lbf": (x1, y1, z1),
        "rbf": (x2, y1, z1),
        "rtf": (x2, y2, z1),
        "ltf": (x1, y2, z1),
        "lbb": (x1, y1, z2),
        "rbb": (x2, y1, z2),
        "rtb": (x2, y2, z2),
        "ltb": (x1, y2, z2),
    }
    add_quad(v["lbf"], v["rbf"], v["rtf"], v["ltf"])
    add_quad(v["lbb"], v["ltb"], v["rtb"], v["rbb"])
    add_quad(v["lbf"], v["lbb"], v["rbb"], v["rbf"])
    add_quad(v["ltf"], v["rtf"], v["rtb"], v["ltb"])
    add_quad(v["lbf"], v["ltf"], v["ltb"], v["lbb"])
    add_quad(v["rbf"], v["rbb"], v["rtb"], v["rtf"])


def add_cylinder_y(x: float, z: float, radius: float, y1: float, y2: float, segments: int = 48) -> None:
    left: list[Vec3] = []
    right: list[Vec3] = []
    for i in range(segments):
        t = 2 * math.pi * i / segments
        px = x + radius * math.cos(t)
        pz = z + radius * math.sin(t)
        left.append((px, y1, pz))
        right.append((px, y2, pz))

    for i in range(segments):
        j = (i + 1) % segments
        add_quad(left[i], left[j], right[j], right[i])

    center_l = (x, y1, z)
    center_r = (x, y2, z)
    for i in range(segments):
        j = (i + 1) % segments
        add_face(center_l, left[i], left[j])
        add_face(center_r, right[j], right[i])


def add_annular_wheel_y(
    x: float,
    z: float,
    outer_radius: float,
    bore_radius: float,
    y1: float,
    y2: float,
    bottom_flat_z: float,
    segments: int = 96,
) -> None:
    outer_l: list[Vec3] = []
    outer_r: list[Vec3] = []
    inner_l: list[Vec3] = []
    inner_r: list[Vec3] = []

    for i in range(segments):
        t = 2 * math.pi * i / segments
        ox = x + outer_radius * math.cos(t)
        oz = max(z + outer_radius * math.sin(t), bottom_flat_z)
        ix = x + bore_radius * math.cos(t)
        iz = z + bore_radius * math.sin(t)
        outer_l.append((ox, y1, oz))
        outer_r.append((ox, y2, oz))
        inner_l.append((ix, y1, iz))
        inner_r.append((ix, y2, iz))

    for i in range(segments):
        j = (i + 1) % segments
        add_quad(outer_l[i], outer_l[j], outer_r[j], outer_r[i])
        add_quad(inner_l[j], inner_l[i], inner_r[i], inner_r[j])
        add_quad(inner_l[i], inner_l[j], outer_l[j], outer_l[i])
        add_quad(inner_r[j], inner_r[i], outer_r[i], outer_r[j])


def add_extruded_profile_y(profile: list[tuple[float, float]], y1: float, y2: float) -> None:
    left = [(x, y1, z) for x, z in profile]
    right = [(x, y2, z) for x, z in profile]

    for i in range(len(profile)):
        j = (i + 1) % len(profile)
        add_quad(left[i], left[j], right[j], right[i])

    base_l = left[0]
    base_r = right[0]
    for i in range(1, len(profile) - 1):
        add_face(base_l, left[i], left[i + 1])
        add_face(base_r, right[i + 1], right[i])


def normal(a: Vec3, b: Vec3, c: Vec3) -> Vec3:
    ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    nx = uy * vz - uz * vy
    ny = uz * vx - ux * vz
    nz = ux * vy - uy * vx
    length = math.sqrt(nx * nx + ny * ny + nz * nz)
    if length == 0:
        return (0.0, 0.0, 0.0)
    return (nx / length, ny / length, nz / length)


def write_binary_stl(path: Path) -> None:
    header = b"print-in-place sedan, captive rolling wheels".ljust(80, b" ")
    with path.open("wb") as f:
        f.write(header)
        f.write(struct.pack("<I", len(faces)))
        for a, b, c in faces:
            n = normal(a, b, c)
            f.write(struct.pack("<3f", *n))
            f.write(struct.pack("<3f", *a))
            f.write(struct.pack("<3f", *b))
            f.write(struct.pack("<3f", *c))
            f.write(struct.pack("<H", 0))


def build_model() -> None:
    # Dimensions are in millimeters. The clearances target common 0.4 mm nozzle FDM printing.
    wheel_radius = 6.0
    wheel_bore = 2.25
    axle_radius = 1.45
    wheel_thickness = 4.8
    cap_radius = 3.2
    cap_thickness = 0.9
    center_z = 5.8
    bottom_flat_z = 0.35
    wheel_y = 16.8
    wheel_xs = (-20.0, 20.0)

    # Chassis and sedan body. The wheels sit outside the body with printable clearance.
    add_box(-31, 31, -11.5, 11.5, 5.6, 10.8)
    add_box(-27, 27, -10.0, 10.0, 3.4, 6.8)
    add_box(-33, -28, -10.5, 10.5, 5.0, 9.4)
    add_box(28, 33, -10.5, 10.5, 5.0, 9.4)

    cabin_profile = [
        (-14.0, 10.8),
        (15.0, 10.8),
        (10.0, 20.5),
        (-7.5, 20.5),
    ]
    add_extruded_profile_y(cabin_profile, -8.3, 8.3)

    # Subtle printable window reliefs as shallow raised panels, not fragile decorative cuts.
    add_box(-8.5, 8.5, -8.9, -8.35, 12.4, 18.3)
    add_box(-8.5, 8.5, 8.35, 8.9, 12.4, 18.3)
    add_box(18.5, 25.0, -10.8, 10.8, 8.0, 10.2)
    add_box(-25.0, -18.5, -10.8, 10.8, 8.0, 10.2)

    # Fixed axles and captive caps. Wheels rotate around the fixed axles after freeing.
    for x in wheel_xs:
        add_cylinder_y(x, center_z, axle_radius, -21.0, 21.0, 48)
        add_box(x - 3.0, x + 3.0, -12.4, 12.4, 3.3, 7.4)

        add_cylinder_y(x, center_z, cap_radius, -21.0, -20.1, 48)
        add_cylinder_y(x, center_z, cap_radius, 20.1, 21.0, 48)
        add_cylinder_y(x, center_z, cap_radius, -13.8, -12.9, 48)
        add_cylinder_y(x, center_z, cap_radius, 12.9, 13.8, 48)

        add_annular_wheel_y(
            x,
            center_z,
            wheel_radius,
            wheel_bore,
            -wheel_y - wheel_thickness / 2,
            -wheel_y + wheel_thickness / 2,
            bottom_flat_z,
            96,
        )
        add_annular_wheel_y(
            x,
            center_z,
            wheel_radius,
            wheel_bore,
            wheel_y - wheel_thickness / 2,
            wheel_y + wheel_thickness / 2,
            bottom_flat_z,
            96,
        )

    # Low front and rear pads keep the car stable without creating support-heavy overhangs.
    add_box(25.5, 32.0, -8.8, 8.8, 2.6, 4.4)
    add_box(-32.0, -25.5, -8.8, 8.8, 2.6, 4.4)


if __name__ == "__main__":
    build_model()
    out = Path("/Users/liyang/Desktop/codex_3d_models/print_in_place_sedan.stl")
    write_binary_stl(out)
    print(f"Wrote {out}")
    print(f"Triangles: {len(faces)}")
