import { generateCommands } from "./procedural.runner.js";
import type { EditorContext } from "../../../shared/types/editor-context.types.js";

const scene: EditorContext = { projectId: "p", revision: 3, activeSceneName: "Main", selectedObjectIds: [], objects: [] };
const program = `return Array.from({ length: 20 }, (_, i) => ({
  commandId: 'c' + i, type: 'scene.create_object', objectId: 'step' + i, name: 'Step ' + i,
  transform: { position: [Math.cos(i), i * .2, Math.sin(i)] }
}));`;

describe("isolated procedural runner", () => {
  it("calculates a procedural layout and does not mutate the input snapshot", async () => {
    const commands = await generateCommands(`scene.objects.push({id: 'local'}); ${program}`, scene);
    expect(commands).toHaveLength(20);
    expect(commands[0]).toMatchObject({ objectId: "step0", transform: { position: [1, 0, 0] } });
    expect(scene.objects).toEqual([]);
  });

  it.each(["process", "require", "fetch", "WebAssembly", "setTimeout"])("does not expose %s", async (name) => {
    await expect(generateCommands(`if (typeof ${name} !== 'undefined') throw Error('exposed'); ${program}`, scene)).resolves.toHaveLength(20);
  });

  it.each([
    "return Function('return process')().env;",
    "return import('node:fs');",
    "return Promise.resolve([]);",
    "throw new Error('bad');",
    "throw { get message() { while(true) {} } };",
    "while (true) {}",
    "const a = []; while(true) a.push(new Array(10000).fill('large'));",
    "return [{commandId:'c', type:'shell.exec', script:'bad'}];",
    "return [{commandId:'c', type:'scene.transform_object', objectId:'x', transform:{position:[NaN,0,0]}}];",
    "return Array.from({length:201}, (_, i) => ({commandId:'c'+i, type:'scene.create_object', objectId:'o'+i, name:'Object'}));",
    "return [];",
  ])("rejects invalid or excessive computation: %s", async (source) => {
    await expect(generateCommands(source, scene)).rejects.toThrow();
    // A failed guest must not poison later runs.
    await expect(generateCommands(program, scene)).resolves.toHaveLength(20);
  });

  it("honors cancellation before starting", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(generateCommands(program, scene, controller.signal)).rejects.toThrow();
  });

  it("benchmarks warm 200-command procedural generation", async () => {
    await generateCommands(program, scene);
    const samples = 20;
    const source = program.replace("length: 20", "length: 200");
    const start = performance.now();
    for (let i = 0; i < samples; i += 1) {
      const commands = await generateCommands(source, scene);
      expect(commands).toHaveLength(200);
    }
    console.info(JSON.stringify({ samples, commands: 200, meanMs: (performance.now() - start) / samples }));
  });
});
