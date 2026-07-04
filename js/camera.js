// camera.js — head state, smoothing, and uniform packing for the off-axis
// projection. Issue #5 (tracking) drives this via setTarget(); until then
// main.js feeds it the mouse position. Nothing here touches WebGL; it only
// produces the smoothed vec3 that renderer.js uploads as uHead.

export class Camera {
  constructor(smoothing = 0.12) {
    this.smoothing = smoothing;          // lerp factor per frame
    this.target = { x: 0, y: 0, z: 0 };
    this.head = { x: 0, y: 0, z: 0 };    // smoothed value
  }

  // #5 calls this each frame (or on each tracking update). x,y normalized
  // [-1,1], z reserved.
  setTarget(x, y, z = 0) {
    this.target.x = x;
    this.target.y = y;
    this.target.z = z;
  }

  // Advance smoothing one frame. Returns the smoothed head object.
  update() {
    const s = this.smoothing;
    this.head.x += (this.target.x - this.head.x) * s;
    this.head.y += (this.target.y - this.head.y) * s;
    this.head.z += (this.target.z - this.head.z) * s;
    return this.head;
  }

  // Pack into a plain array for gl.uniform3fv.
  pack() {
    return [this.head.x, this.head.y, this.head.z];
  }
}
