import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { createCameraEase } from "./cameraEase";

/** A camera and a frame loop the test steps by hand. */
function setup() {
  const camera = { position: new Vector3(0, 0, 10) };
  const target = new Vector3();
  const listeners = new Set<(delta: number) => void>();
  const ease = createCameraEase(camera, target, (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, 1);
  const advance = (seconds: number) => [...listeners].forEach((listener) => listener(seconds));
  return { camera, target, ease, advance, running: () => listeners.size };
}

describe("camera ease", () => {
  it("moves to the goal and then stops asking for frames", () => {
    const { camera, target, ease, advance, running } = setup();
    ease.easeTo(new Vector3(4, 0, 10), new Vector3(4, 0, 0));
    advance(0.5);
    expect(camera.position.x).toBeGreaterThan(0);
    expect(camera.position.x).toBeLessThan(4);
    advance(0.6);
    expect(camera.position.toArray()).toEqual([4, 0, 10]);
    expect(target.toArray()).toEqual([4, 0, 0]);
    expect(running()).toBe(0);
  });

  it("reports where a move under way will end, not where it has got to", () => {
    const { ease, advance } = setup();
    ease.easeTo(new Vector3(4, 0, 10), new Vector3(4, 0, 0));
    advance(0.1);
    const rest = ease.restPose();
    expect(rest.position.toArray()).toEqual([4, 0, 10]);
    expect(rest.target.toArray()).toEqual([4, 0, 0]);
  });

  it("reports the camera itself when nothing moves, and hands out copies", () => {
    const { camera, ease } = setup();
    const rest = ease.restPose();
    expect(rest.position.toArray()).toEqual([0, 0, 10]);
    rest.position.x = 99;
    expect(camera.position.x).toBe(0);
  });

  it("leaves the camera where it is when stopped, and forgets the goal", () => {
    const { camera, ease, advance, running } = setup();
    ease.easeTo(new Vector3(4, 0, 10), new Vector3(4, 0, 0));
    advance(0.5);
    const stoppedAt = camera.position.x;
    ease.stop();
    advance(0.5);
    expect(camera.position.x).toBe(stoppedAt);
    expect(ease.restPose().position.x).toBe(stoppedAt);
    expect(running()).toBe(0);
  });

  it("lets a shift that is undone half way return to the start", () => {
    const { camera, target, ease, advance } = setup();
    const shift = new Vector3(2, 0, 0);
    let rest = ease.restPose();
    ease.easeTo(rest.position.clone().add(shift), rest.target.clone().add(shift));
    advance(0.3);
    rest = ease.restPose();
    ease.easeTo(rest.position.clone().sub(shift), rest.target.clone().sub(shift));
    advance(2);
    expect(camera.position.toArray()).toEqual([0, 0, 10]);
    expect(target.toArray()).toEqual([0, 0, 0]);
  });
});
