import { generateCommands } from "./procedural.runner.js";
import type { EditorContext } from "@movynta/editor-protocol";

const scene: EditorContext = { projectId: "p", revision: 3, activeSceneName: "Main", selectedObjectIds: [], objects: [] };
const program = `return Array.from({ length: 20 }, (_, i) => ({
  commandId: 'c' + i, type: 'scene.create_object', objectId: 'step' + i, name: 'Step ' + i,
  transform: { position: [Math.cos(i), i * .2, Math.sin(i)] }
}));`;

describe("isolated procedural runner", () => {
  it("generates a structured mesh through the isolated command path", async () => {
    const commands = await generateCommands(`const vertices = [[0,0,0],[1,0,0],[0,1,0]];
      return [{ commandId: 'mesh', type: 'geometry.create_mesh', objectId: 'custom', vertices, faces: [[0,1,2]] }];`, scene);
    expect(commands).toMatchObject([{ type: "geometry.create_mesh", objectId: "custom", faces: [[0, 1, 2]] }]);
  });
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

  it("tells the model what its program threw and on which line of its own source", async () => {
    await expect(generateCommands("const first = scene.objects[0];\nreturn [{ commandId: 'a', type: 'scene.delete_object', objectId: first.id }];", scene))
      .rejects.toThrow(/^TypeError: .*\(line 2 of your source\)$/);
    await expect(generateCommands("throw new RangeError('radius must be positive');", scene)).rejects.toThrow("RangeError: radius must be positive (line 1 of your source)");
  });

  it("names the returned command that does not fit the schema", async () => {
    await expect(generateCommands("return [{ commandId: 'ok', type: 'scene.create_object', objectId: 'a', name: 'A' }, { commandId: 'wide', type: 'scene.transform_object', objectId: 'a', transform: { scale: [1, 1] } }];", scene))
      .rejects.toThrow('commands[1] (commandId "wide").transform.scale');
  });

  it("still stops a runaway program with its limits named", async () => {
    await expect(generateCommands("while (true) {}", scene)).rejects.toThrow(/ran past 250ms/);
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
