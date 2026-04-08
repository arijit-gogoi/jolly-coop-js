P6 

Resource scoping is where leaks and ordering bugs show up.
You already have 2 core tests (cleanup-after-tasks, reverse order).
Below are the remaining 13 resource tests.

They validate:

lifetime correctness
cleanup timing
error handling
cancellation interaction
nested scopes
resource usage safety


---

Remaining Resource Tests (13)


---

1. Resource available to tasks
```js
test("resource available inside tasks", async () => {
	let used = false
	await scope(async s => {
		const r = await s.resource({ value: 1 }, () => {})
		s.spawn(async () => {
			used = r.value === 1
		})
	})
	expect(used).toBe(true)
})
```
---

2. Resource disposed even if no tasks

```js
test("resource disposed even without tasks", async () => {
	let disposed = false
	await scope(async s => {
		await s.resource({}, () => {
		  disposed = true
		})
	})
	expect(disposed).toBe(true)
})
```
---

3. Resource disposed after async tasks

```js
test("resource disposed after async tasks complete", async () => {
	let disposed = false
	let finished = false
	await scope(async s => {
		await s.resource({}, () => {
			disposed = true
		})
		s.spawn(async () => {
			  await sleep(5)
			  finished = true
		})
	})
	expect(finished).toBe(true)
	expect(disposed).toBe(true)
})
```
---

4. Resource not disposed before task completion
```js
test("resource not disposed before task finishes", async () => {
	let disposed = false
	let checked = false
	await scope(async s => {
		const r = await s.resource({}, () => {
			disposed = true
		})
		s.spawn(async () => {
		  await sleep(5)
		  checked = !disposed
		})
	})
	expect(checked).toBe(true)
})
```
---

5. Multiple resources all cleaned
```js
test("multiple resources all cleaned", async () => {
	let count = 0
	await scope(async s => {
		await s.resource({}, () => count++)
		await s.resource({}, () => count++)
		await s.resource({}, () => count++)
	})
	expect(count).toBe(3)
})
```
---

6. Resource cleanup runs on error
```js
test("resource cleanup runs on error", async () => {
	let disposed = false
	await expect(
		scope(async s => {
			await s.resource({}, () => {
			    disposed = true
			})
			throw new Error("fail")
			})
		).rejects.toThrow()
	expect(disposed).toBe(true)
})
```
---

7. Resource cleanup runs on cancellation

```js
test("resource cleanup runs on cancel", async () => {
	let disposed = false
	await expect(
		scope(async s => {
			await s.resource({}, () => {
				disposed = true
			})
			s.cancel()
		})
	).rejects.toBeDefined()
	expect(disposed).toBe(true)
})
```
---

8. Resource disposer error does not break scope
```js
test("resource disposer error is contained", async () => {
	await scope(async s => {
		await s.resource({}, () => {
			throw new Error("cleanup fail")
		})
	})
})
```
---

9. Resource disposer errors do not stop other cleanup
```js
test("multiple cleanup continues after error", async () => {
	let ran = false
	await scope(async s => {
		await s.resource({}, () => {
			throw new Error("fail")
		})
		await s.resource({}, () => {
			ran = true
		})
	})
	expect(ran).toBe(true)
})
```
---

10. Resource used across multiple tasks
```js
test("resource shared across tasks", async () => {
	let count = 0
	await scope(async s => {
		const r = await s.resource({ value: 1 }, () => {})
			s.spawn(() => count += r.value)
			s.spawn(() => count += r.value)
		})
	expect(count).toBe(2)
})
```
---

11. Resource disposal order with nested scopes

```js
test("nested scope resources cleaned inner first", async () => {
	const order: number[] = []
	await scope(async s => {
		await s.resource({}, () => order.push(1))
			await scope(async inner => {
			  await inner.resource({}, () => order.push(2))
			})
		})
	expect(order).toEqual([2,1])
})
```
---

12. Resource accessible after await in task

```js
test("resource persists across awaits", async () => {
	let ok = false
	await scope(async s => {
		const r = await s.resource({ value: 1 }, () => {})
		s.spawn(async () => {
			await sleep(5)
			ok = r.value === 1
		})
	})
	expect(ok).toBe(true)
})
```
---

13. Resource not leaked after scope exit
```js
test("resource not leaked after scope exit", async () => {
	let disposed = false
	await scope(async s => {
		await s.resource({}, () => {
			disposed = true
		})
	})
	await sleep(5)
	expect(disposed).toBe(true)
})
```
---

Summary

These 13 tests ensure resource scoping is:

lifetime-bound to scope
cleaned deterministically
safe under error and cancellation
order-correct
non-leaky
usable across tasks
robust under nesting

Combined with your earlier 2 tests, you now have a complete 15-test suite for resources.


---

If you want to go one level deeper (and this is where many runtimes fail), the next step is:

👉 combine resources + cancellation + limits in adversarial tests, which often expose real-world bugs like premature cleanup or double disposal.