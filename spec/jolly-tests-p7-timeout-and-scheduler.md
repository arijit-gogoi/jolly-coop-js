P7

Timeouts and scheduler.  These two areas catch subtle timing and scheduling bugs that don’t appear elsewhere.

You already have 2 tests each. Below are the remaining 8 timeout tests and remaining 8 scheduler fairness tests.

Remaining Timeout Tests (8)

These focus on:

deadline vs timeout
race conditions
interaction with tasks
interaction with cancellation
nested scopes


---

1. Timeout cancels multiple tasks
```js
test("timeout cancels multiple tasks", async () => {
	let ran = 0
	await expect(
		scope({ timeout: 10 }, async s => {
			s.spawn(async () => {
			    await sleep(50)
			    ran++
			})
			s.spawn(async () => {
			    await sleep(50)
			    ran++
			})
		})
	).rejects.toBeDefined()
	expect(ran).toBe(0)
	
})
```
---

2. Timeout triggers even without tasks
```js
test("timeout triggers without tasks", async () => {
	await expect(
		scope({ timeout: 10 }, async () => {
			await sleep(50)
		})
	).rejects.toBeDefined()
})
```
---

3. Timeout vs fast completion race (completion wins)

```js
test("completion wins over timeout race", async () => {
	const result = await scope({ timeout: 20 }, async s => {
		const t = s.spawn(async () => {
			await sleep(5)
			return 1
		})
		return await t
	})
	expect(result).toBe(1)
	
})
```
---

4. Timeout vs error race (error wins if earlier)
```js
test("error before timeout wins", async () => {
	await expect(
	scope({ timeout: 50 }, async s => {
		s.spawn(async () => {
		    throw new Error("fail")
		})
		await sleep(10)
	})
	).rejects.toThrow("fail")
})
```
---

5. Timeout cancels nested scopes

```js
test("timeout cancels nested scopes", async () => {
	let ran = false
	await expect(
		scope({ timeout: 10 }, async s => {
			s.spawn(async () => {
			    await scope(async inner => {
				    inner.spawn(async () => {
				        await sleep(50)
				        ran = true
				    })
			    })
			})
		})
	).rejects.toBeDefined()
	expect(ran).toBe(false)
})
```
---

6. Deadline behaves same as timeout
```js
test("deadline cancels scope", async () => {
	const deadline = Date.now() + 10
	await expect(
		scope({ deadline }, async s => {
			s.spawn(async () => {
			    await sleep(50)
			})
		})
	).rejects.toBeDefined()
})
```
---

7. Timeout does not trigger after scope completion
```js
test("timeout does not trigger after completion", async () => {
	const result = await scope({ timeout: 50 }, async () => {
		return 1
	})
	expect(result).toBe(1)
})
```
---

8. Timeout + manual cancel race
```js
test("manual cancel vs timeout race", async () => {
	await expect(
		scope({ timeout: 50 }, async s => {
			s.spawn(async () => {
			    await sleep(100)
			})
			await sleep(5)
			s.cancel()
		})
	).rejects.toBeDefined()
})
```
---

Remaining Scheduler Fairness Tests (8)

These focus on:

cooperative yielding
queue fairness
starvation prevention
large workloads
ordering guarantees


---

1. Tasks interleave with multiple yields
```js
test("multiple yields interleave tasks", async () => {
	const order: number[] = []
	await scope(async s => {
		s.spawn(async () => {
			order.push(1)
			await yieldNow()
			order.push(3)
			await yieldNow()
			order.push(5)
		})
	
		s.spawn(async () => {
			order.push(2)
			await yieldNow()
			order.push(4)
		})
	})
	expect(order).toEqual([1,2,3,4,5])
})
```
---

2. Long task yields allow others to run
```js
test("long task yields allow others", async () => {
	let ran = false
	await scope(async s => {
		s.spawn(async () => {
			for (let i = 0; i < 5; i++) {
			    await yieldNow()
			}
		})
		s.spawn(async () => {
			ran = true
		})
	})
	expect(ran).toBe(true)
})
```
---

3. No starvation with many short tasks
```js
test("no starvation with many short tasks", async () => {
	let ran = false
	await scope(async s => {
		for (let i = 0; i < 100; i++) {
			s.spawn(async () => {})
		}
		s.spawn(async () => {
			ran = true
		})
	})
	expect(ran).toBe(true)
})
```
---

4. FIFO ordering without yields
```js
test("tasks execute FIFO without yields", async () => {
	const order: number[] = []
	await scope(async s => {
		s.spawn(() => order.push(1))
		s.spawn(() => order.push(2))
		s.spawn(() => order.push(3))
	})
	expect(order).toEqual([1,2,3])
})
```
---

5. Yield allows later task to run before continuation
```js
test("yield allows later task to run first", async () => {
	const order: number[] = []
	await scope(async s => {
		s.spawn(async () => {
			order.push(1)
			await yieldNow()
			order.push(3)
		})
		s.spawn(() => order.push(2))
	})
	expect(order).toEqual([1,2,3])
})
```
---

6. Scheduler handles deep yield chains
```js
test("deep yield chains do not break scheduler", async () => {
	let count = 0
	await scope(async s => {
		s.spawn(async () => {
			for (let i = 0; i < 50; i++) {
			    await yieldNow()
			}
		  count++
		})
	})
	expect(count).toBe(1)
})
```
---

7. Scheduler handles mixed async operations
```js
test("scheduler handles mixed sleep and yield", async () => {
	const order: number[] = []
	await scope(async s => {
		s.spawn(async () => {
			order.push(1)
			await sleep(5)
			order.push(3)
		})
		s.spawn(async () => {
			order.push(2)
			await yieldNow()
			order.push(4)
		})
	})
	expect(order).toContain(1)
	expect(order).toContain(2)
	expect(order).toContain(3)
	expect(order).toContain(4)
})
```
---

8. Scheduler remains stable under many yields
```js
test("scheduler stable under many yields", async () => {
	let count = 0
	await scope(async s => {
		for (let i = 0; i < 100; i++) {
			s.spawn(async () => {
			    await yieldNow()
			    count++
			})
		}
	})
	expect(count).toBe(100)
})
```
---

Final Summary

With these added:

Timeouts (10 total)

Guarantee:

correct cancellation timing
deadline correctness
race safety
nested propagation


---

Scheduler Fairness (10 total)

Guarantee:

no starvation
fair interleaving
yield correctness
queue stability


---

At this point your suite now robustly covers:

time-based behavior
scheduler correctness
cooperative execution guarantees


---

If you want to push this to “runtime-grade reliability” (like Go/Tokio level), the next step is:

👉 adversarial combined tests (limits + cancellation + timeout + yield) — those reveal the deepest bugs.