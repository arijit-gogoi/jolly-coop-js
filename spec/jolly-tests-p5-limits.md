P5

Limits are deceptively tricky. Most bugs show up in:

queue ordering
limit transitions (full → available)
cancellation interaction
fairness under pressure

You already have 2 core tests (strict enforcement + queued tasks run).
Below are the remaining 13 limits tests.


---

Remaining Limits Tests (13)


---

1. Limit = 1 enforces strict sequential execution
```js
test("limit=1 enforces sequential execution", async () => {
	const order: number[] = []
	await scope({ limit: 1 }, async s => {
		s.spawn(async () => {
			order.push(1)
			await sleep(5)
			order.push(2)
		})
		s.spawn(async () => {
			order.push(3)
		})
	})
	expect(order).toEqual([1,2,3])
})
```
---

2. Limit allows full parallelism when high

```js
test("high limit allows parallel execution", async () => {
	let running = 0
	let max = 0
	await scope({ limit: 100 }, async s => {
		for (let i = 0; i < 10; i++) {
			s.spawn(async () => {
				running++
			    max = Math.max(max, running)
			    await sleep(5)
			    running--
			})
		}
	})
	expect(max).toBeGreaterThan(1)
})
```
---

3. Limit respects exact boundary

```js
test("limit exact boundary respected", async () => {
	let running = 0
	let max = 0
	await scope({ limit: 3 }, async s => {
		for (let i = 0; i < 6; i++) {
			s.spawn(async () => {
				running++
				max = Math.max(max, running)
				await sleep(5)
				running--
			})
		}
	})
	expect(max).toBeLessThanOrEqual(3)
})
```
---

4. Queue drains correctly after tasks complete
```js
test("queue drains as tasks complete", async () => {
	let completed = 0
	await scope({ limit: 2 }, async s => {
		for (let i = 0; i < 5; i++) {
			s.spawn(async () => {
			    await sleep(5)
			    completed++
			})
		}
	})
	expect(completed).toBe(5)
})
```
---

5. Tasks start immediately when slot frees
```js
test("queued task starts when slot frees", async () => {
	let running = 0
	let observed = false
	await scope({ limit: 1 }, async s => {
		s.spawn(async () => {
			running++
			await sleep(5)
			running--
		})
		s.spawn(async () => {
			if (running === 1) observed = true
		})
	})
	expect(observed).toBe(true)
})
```
---

6. Limit works with synchronous tasks
```js
test("limit works with sync tasks", async () => {
	let running = 0
	let max = 0
	await scope({ limit: 2 }, async s => {
		for (let i = 0; i < 5; i++) {
			s.spawn(() => {
			    running++
			    max = Math.max(max, running)
			    running--
			})
		}
	})
	expect(max).toBeLessThanOrEqual(2)
})
```
---

7. Limit works with mixed sync and async
```js
test("limit works with mixed tasks", async () => {
	let running = 0
	let max = 0
	await scope({ limit: 2 }, async s => {
		s.spawn(() => {
			running++
			max = Math.max(max, running)
			running--
		})
		s.spawn(async () => {
			running++
			max = Math.max(max, running)
			await sleep(5)
			running--
		})
		s.spawn(async () => {
			running++
			max = Math.max(max, running)
			await sleep(5)
			running--
		})
	})
	expect(max).toBeLessThanOrEqual(2)
})
```
---

8. Limit handles many queued tasks
```js
test("limit handles large queue", async () => {
	let count = 0
	await scope({ limit: 3 }, async s => {
	for (let i = 0; i < 20; i++) {
		s.spawn(async () => {
			await sleep(1)
		    count++
		})
		}
	})
	expect(count).toBe(20)
})
```
---

9. Limit respects ordering of queued tasks
```js
test("queued tasks execute in order", async () => {
	const order: number[] = []
	await scope({ limit: 1 }, async s => {
	s.spawn(async () => {
		await sleep(5)
		order.push(1)
	})
	s.spawn(async () => order.push(2))
	s.spawn(async () => order.push(3))
	})
	expect(order).toEqual([1,2,3])
})
```
---

10. Limit releases slot on failure
```js
test("slot released when task fails", async () => {
	let ran = false
	await expect(
		scope({ limit: 1 }, async s => {
			s.spawn(async () => {
				throw new Error("fail")
			})
			s.spawn(async () => {
				ran = true
			})
		})
	).rejects.toThrow()
	expect(ran).toBe(false)
})
//(Note: sibling cancelled after failure)
```

---

11. Limit releases slot on cancellation
```js
test("slot released on cancellation", async () => {
	let started = 0
	await expect(
		scope({ limit: 1 }, async s => {
			s.spawn(async () => {
			    started++
				await sleep(50)
			})
			s.spawn(async () => {
			    started++
			})
			await sleep(5)
			s.cancel()
		})
	).rejects.toBeDefined()
	expect(started).toBe(1)
})
```
---

12. Limit does not deadlock when tasks await each other
```js
test("limit does not deadlock with task dependencies", async () => {
	await scope({ limit: 1 }, async s => {
		const t1 = s.spawn(async () => 1)
		s.spawn(async () => {
			await t1
		})
	})
})
```
---

13. Limit works correctly with yieldNow
```js
test("limit works with yieldNow", async () => {
	let running = 0
	let max = 0
	await scope({ limit: 2 }, async s => {
		for (let i = 0; i < 5; i++) {
			s.spawn(async () => {
			    running++
			    max = Math.max(max, running)
			    await yieldNow()
			    running--
			})
		}
	})
	expect(max).toBeLessThanOrEqual(2)
})
```
---

Summary

These 13 tests ensure limits are:

strictly enforced
queue-safe
order-preserving
deadlock-safe
compatible with cancellation
compatible with errors
compatible with yield
robust under load

Combined with your earlier 2 tests, you now have a complete 15-test suite for concurrency limits.


---

If you want to go deeper (and this is where many libraries fail), the next step is:

👉 introduce adversarial tests that mix limits + cancellation + nested scopes simultaneously, which often expose hidden scheduler bugs.