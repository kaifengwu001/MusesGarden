# Tulipwind Meadows

A separate, playable tulip-and-windmill planet, guided by the two supplied illustrations. Dense six-petal tulips form pink, coral, yellow, ivory and periwinkle field ribbons; orange-roofed houses sit under tapered windmills with slowly turning lattice sails. Seeded distant mills, field parcels, farm paths and soft clouds extend the scene around the sphere.

Preview: http://localhost:5241/environments/tulip-windmill-meadows/

Mainline commands: `npm.cmd run dev:tulip`, `npm.cmd run check:tulip`, `npm.cmd run build:tulip`. The environment retains its reviewed garden controls and shader contracts locally while using the current shared model loader. Mainline integration evidence and limitations are recorded in [validation](VALIDATION.md).

Latest planting revision: close-packed tulips at approximately34cm spacing fill the beds wherever you explore, including the far hemisphere. Detailed flowers use stable planting-cell identities; simpler distant flowers and painted field bands keep the globe affordable to draw. [Current field view](reference/density-review/after-user-fields.png), [matched earlier view](reference/density-review/before-user-fields.png).

Cottage revision: long gables and compact gardens follow the tulip rows. The former wide dead-end lane is replanted; short curved entrance walks join the existing field tracks with one consistent earth material. Six added cottages across both hemispheres use blue gables, sage porches and rose side-bay designs. [Current garden view](reference/density-review/after-garden.png).

Controls: drag to orbit, scroll to approach, WASD to walk, Q/E for height. Overview/Wander switches camera modes; Flower fields selects a low flower-and-mill view. Grow changes planet size, Bloom opens and colours the native tulips, Wind changes flower sway and sail speed. Seed rerolls the composition. P opens parameters.

Source baseline: 791263247a656a90c8950f4ef866eac564f2ea1f, scaffolded with its clean-source guarded generator into its own branch environment/tulip-windmill-meadows. Environment-specific files stay here; shared src/, server/, existing worlds and the root lockfile stay unchanged. Run native Node24/npm.cmd/npx.cmd from this checkout.

- Serve: npx.cmd vite --host 127.0.0.1 --port 5241 --strictPort
- Type check: npx.cmd tsc -p environments/tulip-windmill-meadows/tsconfig.json
- Lint: npx.cmd eslint environments/tulip-windmill-meadows
- CPU: npx.cmd vitest run environments/tulip-windmill-meadows/dev/tulip.test.ts environments/tulip-windmill-meadows/dev/invariants/params.test.ts environments/tulip-windmill-meadows/dev/invariants/growth.test.ts environments/tulip-windmill-meadows/life/findTable.test.ts --maxWorkers=1
- Build: npx.cmd vite build --config environments/tulip-windmill-meadows/vite.config.ts

[Construction and visual contract](CONSTRUCTION.md), [validation and limitations](VALIDATION.md), [references](reference/README.md).

The retained Muse and example garden UI are inherited engine features. No new account-backed people, real remote travel, general building collision or unique animal ecology is claimed. Garden state and privacy preferences use this world's own browser keys. The old hidden cottage still supplies inherited Muse interaction coordinates; adapting every cottage-specific seated/door pose to the mill house remains a follow-up. Windmills are visible animated scenery, not enterable buildings.
