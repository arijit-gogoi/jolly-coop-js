
P1

Good. This is exactly the right way to prioritize a production test suite.

Below are the 2 highest-signal tests per category — these are the ones that catch the majority of real-world bugs. If these pass reliably, your runtime is already quite robust.


1. Scope Behavior (2 tests)

Scope waits for all tasks

```js
test("scope waits for all tasks", async () => {
	let done = false
	await scope(async s => {
		s.spawn(async () => {
			await sleep(10)
			done = true
		})
	})
	expect(done).toBe(true)
})
```

---

Scope resolves only after nested tasks

```js

test("scope waits for nested tasks", async () => {
	let done = false
	await scope(async s => {
		s.spawn(async () => {
		    await scope(async inner => {
				inner.spawn(async () => {
					await sleep(10)
					done = true
				})
			})
		})
	})
	expect(done).toBe(true)
})
```
---

2. Task Lifecycle (2 tests)

Task resolves correctly

```js
test("task resolves value", async () => {
	await scope(async s => {
		const t = s.spawn(async () => 42)
		const result = await t
		expect(result).toBe(42)
	})
})
```

---

Task completes exactly once

```js
test("task completes exactly once", async () => {
	let runs = 0
	await scope(async s => {
		const t = s.spawn(async () => {
		  runs++
		})
		await t
	})
	expect(runs).toBe(1)
})
```

---

3. Cancellation (2 tests)

First error cancels siblings

```js
test("error cancels sibling tasks", async () => {
	let ran = false
	await expect(
	scope(async s => {
	
	  s.spawn(async () => {
	    throw new Error("fail")
	  })
	  
	  s.spawn(async () => {
	    await sleep(20)
	    ran = true
	  })
	  
	})
	).rejects.toThrow("fail")
	expect(ran).toBe(false)
})
```
---

 Cancel prevents execution of queued tasks

```js
test("cancel prevents queued tasks", async () => {
	let started = 0
	await expect(
		scope(
			{ limit: 1 }, 
			async s => {
				for (let i = 0; i < 5; i++) {
				    s.spawn(async () => {
						started++
					    await sleep(50)
				    })
				}
			await sleep(5)
			s.cancel()
			}
		)
	).rejects.toBeDefined()
	expect(started).toBe(1)
})
```
---

4. Concurrency Limits (2 tests)

Limit strictly enforced

```js
test("limit enforces max concurrency", async () => {
	let running = 0
	let max = 0
	await scope({ limit: 2 }, async s => {
		for (let i = 0; i < 5; i++) {
			s.spawn(async () => {
				running++
				max = Math.max(max, running)
				await sleep(10)
				running--
			})
		}
	})
	expect(max).toBeLessThanOrEqual(2)
})
```
---

Queued tasks eventually execute

```js
test("queued tasks eventually run", async () => {
	let count = 0
	await scope({ limit: 1 }, async s => {
		for (let i = 0; i < 3; i++) {
		  s.spawn(async () => {
		    await sleep(5)
		    count++
		  })
		}
	})
	expect(count).toBe(3)
})
```
---

5. Resources (2 tests)

Resources cleaned after tasks

```js
test("resource cleanup happens after tasks", async () => {
	const order: string[] = []
		await scope(async s => {
			await s.resource({}, () => {
			  order.push("cleanup")
			})
			s.spawn(async () => {
			  order.push("task")
			})
		})
	expect(order).toEqual(["task", "cleanup"])
})
```
---

Cleanup runs in reverse order

```js
test("resources cleaned in reverse order", async () => {
	const order: number[] = []
	await scope(async s => {
		await s.resource({}, () => order.push(1))
		await s.resource({}, () => order.push(2))
	})
	expect(order).toEqual([2,1])
})
```
---

6. Timeouts (2 tests)

Timeout cancels scope

```js
test("timeout cancels running tasks", async () => {
	await expect(
	scope({ timeout: 10 }, async s => {
		s.spawn(async () => {
			await sleep(50)
		})
	})
	).rejects.toBeDefined()
})
```
---

Completion before timeout succeeds

```js
test("completes before timeout", async () => {
	const result = await scope({ timeout: 100 }, async s => {
		const t = s.spawn(async () => {
			await sleep(10)
			return 7
		})
		return await t
	})
	expect(result).toBe(7)
})
```
---

7. Scheduler Fairness (2 tests)

Yield allows interleaving


```js
test("yield allows interleaving", async () => {
	const order: number[] = []
	await scope(async s => {
	s.spawn(async () => {
	  order.push(1)
	  await yieldNow()
	  order.push(3)
	})
	s.spawn(async () => {
	  order.push(2)
	})
	})
	expect(order).toEqual([1,2,3])
})
```
---

Large queue does not starve

```js
test("scheduler does not starve tasks", async () => {
	let ran = false
	await scope(async s => {
		for (let i = 0; i < 1000; i++) {
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

8. Nested Scopes (2 tests)

Nested scope failure propagates

```js
test("nested scope failure propagates", async () => {
	await expect(
		scope(async s => {
			s.spawn(async () => {
				await scope(async inner => {
				    inner.spawn(async () => {
					    throw new Error("fail")
				    })
			    })
			})
		})
	).rejects.toThrow("fail")
})
```
---

Nested cancellation propagates

```js
test("nested cancellation propagates", async () => {
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

9. Stress Tests (2 tests)

High task volume

```js
test("handles thousands of tasks", async () => {
	let count = 0
	await scope(async s => {
		for (let i = 0; i < 5000; i++) {
		  s.spawn(() => count++)
		}
	})
	expect(count).toBe(5000)
})
```
---

Deep nesting stress

```js
test("deep nested scopes stress", async () => {
	await scope(async s => {
		for (let i = 0; i < 100; i++) {
			s.spawn(async () => {
			    await scope(async inner => {
			      inner.spawn(async () => {})
			    })
			})
		}
	})
})
```
---

Final Summary

These 18 tests are the highest-value subset of your full suite.

They collectively validate:

core scope semantics
task lifecycle correctness
cancellation safety
limit enforcement
resource cleanup guarantees
timeout behavior
scheduler fairness
nested scope correctness
high-load stability

If these pass reliably, your runtime is already close to production-safe.


---
