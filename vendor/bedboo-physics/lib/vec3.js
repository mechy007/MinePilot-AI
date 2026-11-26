'use strict';

// Minimal Vec3 implementation for the vendored physics engine. Methods match
// the subset of prismarine-physics' vec3 contract used by this engine.
class Vec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = Number(x);
    this.y = Number(y);
    this.z = Number(z);
  }
  set(x, y, z) {
    this.x = Number(x); this.y = Number(y); this.z = Number(z);
    return this;
  }
  clone() { return new Vec3(this.x, this.y, this.z); }
  offset(x = 0, y = 0, z = 0) { return new Vec3(this.x + x, this.y + y, this.z + z); }
  translate(x = 0, y = 0, z = 0) {
    this.x += x; this.y += y; this.z += z;
    return this;
  }
  add(other) {
    this.x += other.x; this.y += other.y; this.z += other.z;
    return this;
  }
  floored() { return new Vec3(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)); }
  norm() { return Math.hypot(this.x, this.y, this.z); }
  normalize() {
    const length = this.norm();
    if (length > 0) { this.x /= length; this.y /= length; this.z /= length; }
    return this;
  }
}

module.exports = { Vec3 };
