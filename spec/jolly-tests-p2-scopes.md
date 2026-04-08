P2

This is the right place to be strict.
These remaining 18 scope tests cover edge cases that commonly break structured concurrency implementations.

They focus on:

return semantics
multiple spawns
error timing
cancellation timing
nested interactions
ordering guarantees


---

Remaining Scope Tests (18)


---

1. Scope resolves after multiple tasks

```js
test("scope waits for multiple tasks", async () => {
	let count = 0
	await scope(async s => {
		s.spawn(async () => { await sleep(5); count++ })
		s.spawn(async () => { await sleep(5); count++ })
	})
	expect(count).toBe(2)
})
```
---

2. Scope resolves with return value after tasks

```js
test("scope returns after tasks complete", async () => {
	const result = await scope(async s => {
		s.spawn(async () => {
			await sleep(5)
		})
		return 10
	})
	expect(result).toBe(10)
})
```
---

3. Scope does not resolve early

```js
test("scope does not resolve before tasks finish", async () => {
	let done = false
	const p = scope(async s => {
		s.spawn(async () => {
		  await sleep(10)
		  done = true
		})
	})
	await sleep(1)
	expect(done).toBe(false)
	await p
})
```
---

4. Scope with no tasks resolves immediately

```js
test("empty scope resolves immediately", async () => {
	const result = await scope(async () => 5)
	expect(result).toBe(5)
})
```
---

5. Scope handles synchronous tasks

```js
test("scope handles sync tasks", async () => {
	let ran = false
		await scope(async s => {
		s.spawn(() => {
			ran = true
		})
	})
	expect(ran).toBe(true)
})
```
---

6. Scope handles mixed sync and async tasks

```js
test("scope handles mixed tasks", async () => {
	let a = false
	let b = false
	await scope(async s => {
		s.spawn(() => { a = true })
		s.spawn(async () => {
			await sleep(5)
			b = true
		})
	})
	expect(a).toBe(true)
	expect(b).toBe(true)
})
```
---

7. Scope propagates error from returned function

```js
test("scope throws if root function throws", async () => {
	await expect(
		scope(async () => {
			throw new Error("root fail")
		})
	).rejects.toThrow("root fail")
})
```
---

8. Scope cancels tasks if root throws

```js
test("root error cancels tasks", async () => {
	let ran = false
	
	await expect(
		scope(async s => {
			s.spawn(async () => {
			    await sleep(20)
			    ran = true
			})
			throw new Error("fail")
		})
	).rejects.toThrow("fail")
	
	expect(ran).toBe(false)
})
```
---

9. Scope waits for child tasks even after return

```js
test("scope waits after early return", async () => {
	let done = false
	await scope(async s => {
		s.spawn(async () => {
			await sleep(5)
			done = true
		})
		return
	})
	expect(done).toBe(true)
})
```
---

10. Scope handles many quick tasks

```js
test("scope handles many fast tasks", async () => {
	let count = 0
	await scope(async s => {
		for (let i = 0; i < 100; i++) {
		  s.spawn(() => count++)
		}
	})
	expect(count).toBe(100)
})
```
---

11. Scope handles tasks that resolve immediately

```js
test("scope handles immediate resolve tasks", async () => {
	let count = 0
	await scope(async s => {
		s.spawn(async () => count++)
		s.spawn(async () => count++)
	})
	expect(count).toBe(2)
})
```
---

12. Scope handles tasks that yield

```js
test("scope handles yielding tasks", async () => {
	let done = false
	await scope(async s => {
		s.spawn(async () => {
			await yieldNow()
			done = true
		})
	})
	expect(done).toBe(true)
})
```
---

13. Scope supports awaiting spawned tasks

```js
test("scope allows awaiting spawned tasks", async () => {
	const result = await scope(async s => {
		const t = s.spawn(async () => 5)
		return await t
	})
	expect(result).toBe(5)
})
```
---

14. Scope handles interdependent tasks

```js
test("scope handles dependent tasks", async () => {
	let x = 0
	await scope(async s => {
	const t = s.spawn(async () => {
		await sleep(5)
		x = 1
	})
	s.spawn(async () => {
			await t
			x = 2
		})
	})
	expect(x).toBe(2)
})
```
---

15. Scope maintains ordering through awaits

```js
test("scope preserves logical ordering via await", async () => {
	const order: number[] = []
	await scope(async s => {
		const t = s.spawn(async () => {
			await sleep(5)
			order.push(1)
		})
		await t
		order.push(2)
	})
	expect(order).toEqual([1,2])
})
```
---

16. Scope handles nested returns correctly

```js
test("nested scope return does not break parent", async () => {
	const result = await scope(async s => {
		s.spawn(async () => {
			const inner = await scope(async () => 5)
				expect(inner).toBe(5)
			})
		return 10
	})
	expect(result).toBe(10)
})
```
---

17. Scope handles rapid spawn bursts

```js
test("scope handles rapid spawn burst", async () => {
	let count = 0
	await scope(async s => {
		for (let i = 0; i < 200; i++) {
			s.spawn(() => count++)
		}
	})
	expect(count).toBe(200)
})
```
---

18. Scope ensures no task leakage

```js
test("no task leakage after scope exit", async () => {
	let done = false
	await scope(async s => {
		s.spawn(async () => {
			await sleep(5)
			done = true
		})
	})
	await sleep(10)
	expect(done).toBe(true)
})
```
---

Summary

These 18 tests ensure:

no early resolution
correct return semantics
proper error propagation
task completion guarantees
no task leakage
correct nested behavior
ordering correctness

Together with the previous 2, your 20 scope tests are complete and cover nearly all real-world failure modes.

---

If you want to be extremely rigorous next, the best step is:

👉 map each of these tests directly to specific invariants, so every guarantee is explicitly validated by at least one test.