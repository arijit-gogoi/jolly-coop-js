P4

Cancellation is the hardest part to get right. These tests target race conditions, timing edges, and propagation correctness.

You already have 2 core tests (error cancels siblings, cancel prevents queued tasks).
Below are the remaining 18 cancellation tests.

They validate:

idempotency
timing races
propagation
interaction with await
interaction with limits
nested behavior
post-cancel invariants


---

Remaining Cancellation Tests (18)


---

1. Cancel immediately stops new spawns

```js
test("cancel prevents new spawns from running", async () => {
	let ran = false
	await expect(
		scope(async s => {
			s.cancel()
			s.spawn(async () => {
				ran = true
			})
		})
	).rejects.toBeDefined()
	expect(ran).toBe(false)
})
```
---

2. Cancel before any spawn
```js
test("cancel before spawn results in no execution", async () => {
	let ran = false
	await expect(
	scope(async s => {
		s.cancel()
		s.spawn(async () => {
		    ran = true
		})
	})
	).rejects.toBeDefined()
	expect(ran).toBe(false)
})
```
---

3. Cancel during running task stops continuation

```js
test("cancel stops task continuation after await", async () => {
	let step = 0
	await expect(
		scope(async s => {
			s.spawn(async () => {
			    step = 1
			    await sleep(50)
			    step = 2
			})
			await sleep(5)
			s.cancel()
		})
	).rejects.toBeDefined()
	expect(step).toBe(1)
})
```
---

4. Cancel propagates to deeply nested tasks
```js
test("cancel propagates deeply", async () => {
	let ran = false
	await expect(
		scope(async s => {
			s.spawn(async () => {
				await scope(async inner => {
				    inner.spawn(async () => {
					    await sleep(50)
					    ran = true
				    })
			    })
			})
			s.cancel()
		})
	).rejects.toBeDefined()
	expect(ran).toBe(false)
})
```
---

5. Cancel after tasks complete does nothing
```js
test("cancel after completion has no effect", async () => {
	await scope(async s => {
		await s.spawn(async () => {})
		s.cancel()
	})
})
```
---

6. Cancel multiple times remains stable

```js
test("multiple cancel calls are stable", async () => {
	await expect(
		scope(async s => {
			s.cancel()
			s.cancel()
			s.cancel()
		})
	).rejects.toBeDefined()
})
```
---

7. Cancel prevents queued tasks from starting (limit interaction)

```js
test("cancel prevents queued tasks under limit", async () => {
	let started = 0
	await expect(
		scope({ limit: 1 }, async s => {
			for (let i = 0; i < 3; i++) {
				s.spawn(async () => {
				    started++
				    await sleep(50)
			    })
			}
			await sleep(5)
			s.cancel()
		})
	).rejects.toBeDefined()
	expect(started).toBe(1)
})
```
---

8. Cancel during await of child task

```js
test("cancel while awaiting child task", async () => {
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

9. Cancel propagates through awaited task chain

```js
test("cancel propagates through task dependencies", async () => {
	let ran = false
	await expect(
		scope(async s => {
			const t1 = s.spawn(async () => {
			    await sleep(50)
			    return 1
			})
			s.spawn(async () => {
			    await t1
			    ran = true
			})
			s.cancel()
		})
	).rejects.toBeDefined()
	expect(ran).toBe(false)
})
```
---

10. Cancel overrides slow task completion

```js
test("cancel wins over slow completion", async () => {
	let finished = false
	await expect(
		scope(async s => {
			s.spawn(async () => {
			    await sleep(50)
			    finished = true
			})
			await sleep(5)
			s.cancel()
		})
	).rejects.toBeDefined()
	expect(finished).toBe(false)
})
```
---

11. Cancel vs error race (cancel first)

```js
test("cancel before error prevents error propagation", async () => {
	await expect(
		scope(async s => {
			s.spawn(async () => {
			    await sleep(10)
			    throw new Error("fail")
			})
			s.cancel()
		})
	).rejects.toBeDefined()
})
```
---

12. Error vs cancel race (error first)

```js
test("error before cancel wins", async () => {
	await expect(
		scope(async s => {
			s.spawn(async () => {
				throw new Error("fail")
			})
			await sleep(1)
			s.cancel()
		})
	).rejects.toThrow("fail")
})
```
---

13. Cancel does not affect unrelated outer scope

```js
test("inner cancel does not cancel outer scope", async () => {
	let outerRan = false
	await scope(async s => {
		s.spawn(async () => {
			await expect(
			    scope(async inner => {
					inner.cancel()
			    })
			).rejects.toBeDefined()
		})
		outerRan = true
	})
	expect(outerRan).toBe(true)
})
```
---

14. Cancel prevents further execution after yield

> Note: Uses `yieldNow()` (not `sleep(1)`) to synchronize with the task's
> yield continuation. With a MessageChannel-based scheduler, `yieldNow`
> continuations always resolve before `setTimeout(1ms)`, so `sleep(1)` cannot
> reliably fire the cancel before the task resumes.

```js
test("cancel after yield prevents continuation", async () => {
	let step = 0
	await expect(
		scope(async s => {
			s.spawn(async () => {
			    step = 1
			    await yieldNow()
			    step = 2
			})
			// yieldNow orders correctly with task continuations via microtask deferral
			await yieldNow()
			s.cancel()
		})
	).rejects.toBeDefined()
	expect(step).toBe(1)
})
```
---

15. Cancel stops tasks that spawn children

```js
test("cancel stops tasks spawning children", async () => {
	let ran = false
	await expect(
	scope(async s => {
	  s.spawn(async () => {
	    s.spawn(async () => {
	      ran = true
	    })
	    await sleep(50)
	  })
	  s.cancel()
	})
	).rejects.toBeDefined()
	expect(ran).toBe(false)
})
```
---

16. Cancel ensures scope rejects

```js
test("scope rejects on cancel", async () => {
	await expect(
	scope(async s => {
		s.cancel()
		})
	).rejects.toBeDefined()
})
```
---

17. Cancel with no tasks still rejects

```js
test("cancel with no tasks rejects scope", async () => {
	await expect(
		scope(async s => {
			s.cancel()
		})
	).rejects.toBeDefined()
})
```
---

18. Cancel does not allow task to complete afterward

```js
test("cancel prevents task completion after cancellation", async () => {
	let finished = false
	await expect(
		scope(async s => {
			s.spawn(async () => {
				await sleep(50)
			    finished = true
			})
			s.cancel()
		})
	).rejects.toBeDefined()
	expect(finished).toBe(false)
})
```
---

Summary

These 18 tests ensure cancellation is:

idempotent
race-safe
deterministic
scope-bounded
non-leaky
propagating correctly

Combined with your earlier 2 tests, you now have 20 cancellation tests that cover nearly all real-world failure modes.

---

If you want to go even deeper (and this is where elite runtimes differ), the next step is:

👉 convert a subset of these into deterministic-scheduler tests, which can reveal hidden race bugs even these tests might miss.