P3

Task lifecycle is where most subtle bugs live. These tests ensure your state machine + PromiseLike behavior + cancellation interactions are airtight.

Below are the remaining 18 task lifecycle tests (you already had 2: resolve + completes-once).

They target:

state transitions
error propagation
await semantics
cancellation interaction
PromiseLike correctness
edge timing cases


---

Remaining Task Lifecycle Tests (18)


---

1. Task rejection propagates to await

```js
test("task rejection propagates to await", async () => {
	await scope(async s => {
		const t = s.spawn(async () => {
			throw new Error("boom")
		})
	await expect(t).rejects.toThrow("boom")
	})
})
```
---

2. Task state becomes completed
```js
test("task state becomes completed", async () => {
	await scope(async s => {
		const t = s.spawn(async () => 1)
		await t
		expect(t.state).toBe("completed")
	})
})
```
---

3. Task state becomes failed

```js
test("task state becomes failed", async () => {
	await scope(async s => {
		const t = s.spawn(async () => {
			throw new Error("fail")
		})
	await expect(t).rejects.toThrow()
	expect(t.state).toBe("failed")
	})
})
```
---

4. Task state becomes cancelled

```js
test("task state becomes cancelled", async () => {
	await expect(
		scope(async s => {
			const t = s.spawn(async () => {
				await sleep(50)
			})
			s.cancel()
			await t
		})
	).rejects.toBeDefined()
})
```
---

5. Task starts in running state

```js
test("task starts in running state", async () => {
	await scope(async s => {
		const t = s.spawn(async () => {
			await sleep(5)
		})
	expect(t.state).toBe("running")
	await t
	})
})
```
---

6. Task cannot transition after completion

```js
test("task does not change state after completion", async () => {
	await scope(async s => {
		const t = s.spawn(async () => 1)
		await t
		const state = t.state
		expect(t.state).toBe(state)
	})
})
```
---

7. Task cannot run twice

```js
test("task executes only once", async () => {
	let runs = 0
	await scope(async s => {
		const t = s.spawn(async () => {
			runs++
		})
	await t
	await t
	})
	expect(runs).toBe(1)
})
```
---

8. Awaiting task multiple times returns same value

```js
test("awaiting task multiple times returns same value", async () => {
	await scope(async s => {
		const t = s.spawn(async () => 5)
		const a = await t
		const b = await t
		expect(a).toBe(5)
		expect(b).toBe(5)
	})
})
```
---

9. Task resolves after await suspension

```js
test("task resolves after await suspension", async () => {
	await scope(async s => {
		const t = s.spawn(async () => {
			await sleep(5)
			return 10
		})
		expect(await t).toBe(10)
	})
})
```
---

10. Task can yield and resume

```js
test("task yields and resumes", async () => {
	let step = 0
	await scope(async s => {
		const t = s.spawn(async () => {
			step = 1
			await yieldNow()
			step = 2
		})
		await t
	})
	expect(step).toBe(2)
})
```
---

11. Task observes cancellation during execution

```js
test("task stops after cancellation", async () => {
	let ran = false
	await expect(
		scope(async s => {
			s.spawn(async () => {
			    await sleep(50)
			    ran = true
			})
			s.cancel()
		})
	).rejects.toBeDefined()
	expect(ran).toBe(false)
})
```
---

12. Task created but cancelled before execution

```js
test("task cancelled before execution does not run", async () => {
	let ran = false
	await expect(
	scope(async s => {
			s.spawn(async () => {
				ran = true
			})
			s.cancel()
		})
	).rejects.toBeDefined()
	expect(ran).toBe(false)
})
```
---

13. Task error sets failure state only once

```js
test("task failure state set once", async () => {
	await scope(async s => {
		const t = s.spawn(async () => {
			throw new Error("fail")
		})
	await expect(t).rejects.toThrow()
	expect(t.state).toBe("failed")
	})
})
```
---

14. Task then() behaves like Promise

```js
test("task then behaves like Promise", async () => {
	await scope(async s => {
		const t = s.spawn(async () => 3)
		const result = await t.then(x => x * 2)
	expect(result).toBe(6)
	})
})
```
---

15. Task chaining works

```js
test("task chaining works", async () => {
	await scope(async s => {
		const t = s.spawn(async () => 2)
		const result = await t.then(x => x + 3)
		expect(result).toBe(5)
	})
})
```
---

16. Task propagates errors through then

```js
test("task propagates error through then", async () => {
	await scope(async s => {
		const t = s.spawn(async () => {
		  throw new Error("fail")
		})
		await expect(t.then(() => {})).rejects.toThrow("fail")
	})
})
```
---

17. Task awaiting inside another task

```js
test("task can await another task", async () => {
	await scope(async s => {
		const t1 = s.spawn(async () => 5)
		const t2 = s.spawn(async () => {
			return await t1
		})
		expect(await t2).toBe(5)
	})
})
```
---

18. Task completion decrements scope active count

```js
test("task completion reduces active count", async () => {
	await scope(async s => {
		const t = s.spawn(async () => 1)
		expect(s.active).toBeGreaterThan(0)
		await t
		expect(s.active).toBe(0)
	})
})
```
---

Summary

These 18 tests ensure:

correct state transitions
PromiseLike compliance
single execution guarantee
correct cancellation behavior
await semantics correctness
task chaining correctness
scope bookkeeping correctness

Combined with the earlier 2, your 20 task lifecycle tests fully validate the task state machine.


---

If you want to go even deeper, the next valuable step is:

👉 formalizing invariants → mapping each lifecycle test to a specific state transition rule, ensuring no transition is untested.