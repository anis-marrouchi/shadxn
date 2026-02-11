export class AsyncQueue<T> {
  private queue: T[] = []
  private resolvers: Array<(value: IteratorResult<T>) => void> = []
  private closed = false

  push(item: T): void {
    if (this.closed) return

    const resolver = this.resolvers.shift()
    if (resolver) {
      resolver({ value: item, done: false })
      return
    }
    this.queue.push(item)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const resolve of this.resolvers.splice(0)) {
      resolve({ value: undefined as any, done: true })
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.queue.length) {
      return { value: this.queue.shift() as T, done: false }
    }
    if (this.closed) {
      return { value: undefined as any, done: true }
    }
    return new Promise<IteratorResult<T>>((resolve) => {
      this.resolvers.push(resolve)
    })
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      const { value, done } = await this.next()
      if (done) return
      yield value
    }
  }
}

