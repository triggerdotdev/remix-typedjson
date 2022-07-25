type NonJsonTypes =
  | 'date'
  | 'set'
  | 'map'
  | 'regexp'
  | 'bigint'
  | 'undefined'
  | 'infinity'
  | '-infinity'
  | 'nan'
  | 'error'
type EntryType = {
  type: NonJsonTypes | 'object'
  value: any
  count: number
  iteration: number
}
function serialize<T>(data: T): {
  json?: string | null
  meta?: Record<string, NonJsonTypes>
} {
  if (data === null) return { json: 'null' }
  if (data === undefined) return { json: undefined }

  const stack: EntryType[] = []
  const keys: string[] = ['']
  const meta = new Map()
  function replacer(key: string, value: any) {
    let entry: EntryType | undefined
    if (stack.length) {
      entry = stack[stack.length - 1]
      entry.iteration++
      if (entry.iteration > entry.count) {
        if (entry.type === 'object') {
          keys.pop()
        }
        stack.pop()
        entry = stack[stack.length - 1]
        entry.iteration++
      }
    }
    if (entry) {
      value = entry.value[key]
    }
    let metaKey = `${keys[keys.length - 1]}${key}`
    const valueType = typeof value
    if (valueType === 'object' && value !== null) {
      let count = 0
      let t: NonJsonTypes | 'object' = 'undefined'
      if (value instanceof Date) {
        t = 'date'
        value = value.toISOString()
      } else if (value instanceof Set) {
        value = Array.from(value)
        count = value.length
        t = 'set'
      } else if (value instanceof Map) {
        value = Object.fromEntries(value)
        count = Object.keys(value).length
        t = 'map'
      } else if (value instanceof Array) {
        count = value.length
      } else if (value instanceof RegExp) {
        t = 'regexp'
        value = String(value)
      } else if (value instanceof Error) {
        t = 'error'
        value = { name: value.name, message: value.message, stack: value.stack }
        // push error value to stack
        stack.push({ type: 'object', value, count: 3, iteration: 0 })
      } else {
        count = Object.keys(value).length
        t = 'object'
      }
      if (t !== 'undefined' && t !== 'object') {
        meta.set(metaKey, t)
      }
      if (count !== 0) {
        stack.push({ type: t, value, count, iteration: 0 })
        if (key && t === 'object') {
          keys.push(`${metaKey}.`)
        }
        return value
      }
    }
    // handle non-object types
    if (valueType === 'bigint') {
      meta.set(metaKey, 'bigint')
      return String(value)
    }
    if (valueType === 'number') {
      if (value === Number.POSITIVE_INFINITY) {
        meta.set(metaKey, 'infinity')
        return 'Infinity'
      }
      if (value === Number.NEGATIVE_INFINITY) {
        meta.set(metaKey, '-infinity')
        return '-Infinity'
      }
      if (Number.isNaN(value)) {
        meta.set(metaKey, 'nan')
        return 'NaN'
      }
    }
    if (typeof value === 'undefined') {
      meta.set(metaKey, 'undefined')
      return null
    }
    return value
  }
  const json = JSON.stringify(data, replacer)
  return {
    json,
    meta: meta.size === 0 ? undefined : Object.fromEntries(meta.entries()),
  }
}

function deserialize<T>({
  json,
  meta,
}: {
  json: string | null
  meta?: Record<string, NonJsonTypes>
}): T | null {
  if (!json) return null
  const result = JSON.parse(json)
  if (meta) {
    const keys = Object.keys(meta)
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      applyConversion(result, key.split('.'), meta[key])
    }
  }
  function applyConversion(
    result: any,
    keys: string[],
    type: NonJsonTypes,
    depth: number = 0,
  ) {
    const key = keys[depth]
    if (depth < keys.length - 1) {
      applyConversion(result[key], keys, type, depth + 1)
      return
    }
    const value = result[key]
    switch (type) {
      case 'date':
        result[key] = new Date(value)
        break
      case 'set':
        result[key] = new Set(value)
        break
      case 'map':
        result[key] = new Map(Object.entries(value))
        break
      case 'regexp':
        const match = /^\/(.*)\/([dgimsuy]*)$/.exec(value)
        if (match) {
          result[key] = new RegExp(match[1], match[2])
        } else {
          throw new Error(`Invalid regexp: ${value}`)
        }
        break
      case 'bigint':
        result[key] = BigInt(value)
        break
      case 'undefined':
        result[key] = undefined
        break
      case 'infinity':
        result[key] = Number.POSITIVE_INFINITY
        break
      case '-infinity':
        result[key] = Number.NEGATIVE_INFINITY
        break
      case 'nan':
        result[key] = NaN
        break
      case 'error':
        const err = new Error(value.message)
        err.name = value.name
        err.stack = value.stack
        result[key] = err
        break
    }
  }
  return result as T
}

function stringify<T>(data: T) {
  let { json, meta } = serialize(data)
  if (json && meta) {
    if (json.startsWith('{')) {
      json = `${json.substring(0, json.length - 2)},"__meta__":${JSON.stringify(
        meta,
      )}}`
    } else if (json.startsWith('[')) {
      json = `{"__json__"":${json},"__meta__":${JSON.stringify(meta)}}`
    }
  }
  return json
}

function parse<T>(json: string) {
  let data = JSON.parse(json)
  if (data.__json__) {
    // handle arrays wrapped in an object
    return deserialize<T>({ json: data.__json__, meta: data.__meta__ })
  } else if (data.__meta__) {
    // handle json object with __meta__ key
    // remove before sending to deserialize
    const meta = data.__meta__
    delete data.__meta__
    return deserialize<T>({ json, meta })
  }
  return data
}

const typedjson = {
  serialize,
  stringify,
  deserialize,
  parse,
}

export { serialize, deserialize, stringify, parse }
export default typedjson
