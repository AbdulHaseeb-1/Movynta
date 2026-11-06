---
name: character-modeling
version: 1.2.0
description: Plans and builds 3D character bodies from primitives, using head-unit proportions, anatomical landmarks, shape language and correct joint pivots for realistic, heroic, stylized and chibi styles.
dimensions:
  - 3d
tags:
  - character
  - humanoid
  - body
  - model
  - anatomy
  - chibi
when_to_use:
  - The user asks for a new 3D character, figure, or humanoid body.
  - The user asks to block out proportions before detailing.
  - The user asks to fix or improve a character's proportions, anatomy or style.
required_inputs:
  - Character goal and style (for example: stylized, realistic, chibi).
  - Target height in scene units, and the number of body parts to block out.
tools:
  - editor.get_context
  - editor.measure
  - viewport.capture
  - modeling.generate_model_plan
  - editor.propose_commands
  - editor.apply_proposal
  - validation.check_scene
validation:
  - Every object has a unique id and a finite transform before a proposal is created.
  - The figure's group has the same scale on every axis.
  - Every part has a role name (Torso, Head, Arm.L) and sits under the figure's group, never at the top level. Arms sit under the torso, which is under the group.
  - The proposal references only objects present in the latest editor context.
  - validation.check_scene reports no error-severity issues after the change is applied.
error_handling:
  - If the editor is not connected, stop and report that the editor must be open.
  - If a proposal is rejected or fails with a revision conflict, read the context again and build a new proposal.
  - If the editor is too old for name, parentId and transform on shapes, create each part and then use `scene.rename_object`, `scene.set_parent` and `scene.transform_object`.
  - Never delete existing objects to make room for new ones unless the user asked for it.
---

# Character modeling workflow

1. Call `editor.get_context` and note the existing objects and the revision.
2. Call `modeling.generate_model_plan` with the goal, the dimension `3d`, and the ordered body-part steps (torso, head, arms, legs). Keep each step small.
3. Create one empty group for the whole figure with `scene.create_object`, named for the character (for example `Character`), at the origin with no scale. Then, for each part, add one `geometry.create_primitive` with its own new `objectId` (use the step ids as the basis), a role `name` (`Torso`, `Head`, `Arm.L`, `Arm.R`), and a `transform` that places it relative to its parent. The torso and the other parts of the body take `parentId` set to the group. The arms take the torso's `objectId` as their `parentId`, so they move and turn with the torso; create the torso before them. A primitive is already an object, so do not create the same `objectId` with `scene.create_object` first. A part that belongs to another part (a hand on an arm) uses that part's `objectId` as its `parentId`. Create a parent before the parts that go under it.
4. Submit everything with `editor.propose_commands`. Keep proposals under 20 commands so they are easy to review. The apply result lists the `name` each object ended up with; a name that a sibling already had gets a number such as `Arm.L.001`, so read it back instead of assuming.
5. Call `editor.apply_proposal` with the returned proposal id. The user may need to approve it first.
6. Call `validation.check_scene`. Fix any error-severity issues with a new proposal.
7. Report the created objects and anything the user should review.

When the scene holds more than one thing (several characters, props, a set), put each in its own collection named for it: `scene.create_collection`, then `collectionId` on the figure's group (its parts join it when they are created under it). A collection only organizes and can be hidden as a whole; it never moves anything.

Use scene units, keep the character centred on the origin, and place feet on the ground plane (y = 0). To move the whole figure later, change the group alone: `scene.move_object` adds a distance to where it is now (and keeps anything the user moved since you read the scene), and `scene.transform_object` sets exact values or turns and scales it. Do not move the parts one by one. Keep the group's scale the same on every axis; an unevenly scaled group cannot take a turned part by `scene.set_parent`.

## Proportions by style

Measure in **head units** (H = height of the head, chin to crown). Total height = heads × H.

| Style | Heads tall | Notes |
| --- | --- | --- |
| Chibi / super-deformed | 2–3 | Head about as big as the body; tiny hands and feet; no neck |
| Toy-like / cartoon | 3–5 | Big head and hands, short limbs, simple shapes |
| Stylized hero | 5–7 | Exaggerate one trait (shoulders, hands, head) |
| Realistic adult | 7–7.5 (women about 7–7.5, men 7.5–8) | Average human |
| Idealized / heroic | 8–8.5 | Longer legs, broader shoulders |

Landmarks for a 7.5–8 head adult, measured from the crown down:

- 1 H: chin. 1⅓ H: base of the neck. 2 H: nipple line. 3 H: navel and elbows. 4 H: crotch, which is about half of total height; wrists hang level with it.
- 5½–6 H: knees, about 2 H above the floor. Ankles about ½ H above the floor.
- Shoulder width about 2–2⅓ H for men and 1¾–2 H for women; hips about 1½ H for men and 1¾–2 H for women.
- Upper arm about 1½ H, forearm about 1¼ H, hand about ¾ H (roughly the face from chin to hairline). Thigh about 2 H, shin about 2 H, foot about 1 H long.
- Arms hanging down reach mid-thigh; arm span is about equal to height.

Stylized work keeps the landmark order but stretches or shrinks the parts; chibi figures put the crotch around 1½–2 H from the top and drop the neck.

## Shape and appeal

- Pick a dominant **shape language** for the personality: round for friendly, square for strong and steady, triangular (wide shoulders, narrow waist, pointed shapes) for heroic, fast or villainous.
- Vary sizes: one big mass (torso or head), medium masses (limbs), small details (hands, feet, features). Avoid making every part the same thickness.
- Give limbs a slight taper (wider at the top: cylinder `radiusTop` larger than `radiusBottom`) and avoid perfectly straight, stiff tubes. A light forward tilt of the head and slightly bent arms read more natural than a rigid T-pose; use an A-pose (arms about 30–45° down) when the user does not ask for a pose.
- Keep the centre of mass over the feet so the figure looks like it can stand.

## Joint pivots

Place each limb so its pivot is at the joint: a limb part's local origin sits at the shoulder, hip, elbow or knee, and the geometry hangs from it (offset the mesh half its length along the limb inside a child, or position the part so its top is at the joint). Then rotating `Arm.L` turns it around the shoulder instead of its middle. Mirror left and right parts across x = 0 (`.L` at +x, `.R` at −x) with identical sizes.

## Visual check

After applying the blockout, call `viewport.capture` on the character's group with orthographic `front` and `right` views and `guides: true`. Compare landmarks to the table (crotch near half height, knees near a quarter of height above the floor) and use `editor.measure` for total height. Fix proportions before adding detail.
