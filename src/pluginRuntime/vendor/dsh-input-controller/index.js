// 生成物：scripts/build-client-helpers.mjs；官方来源见 vendor/dsh-input-controller/README.md。
// node_modules/zustand/esm/vanilla.mjs
var createStoreImpl = (createState) => {
  let state;
  const listeners = /* @__PURE__ */ new Set();
  const setState = (partial, replace) => {
    const nextState = typeof partial === "function" ? partial(state) : partial;
    if (!Object.is(nextState, state)) {
      const previousState = state;
      state = (replace != null ? replace : typeof nextState !== "object" || nextState === null) ? nextState : Object.assign({}, state, nextState);
      listeners.forEach((listener) => listener(state, previousState));
    }
  };
  const getState = () => state;
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const destroy = () => {
    if ((import.meta.env ? import.meta.env.MODE : void 0) !== "production") {
      console.warn(
        "[DEPRECATED] The `destroy` method will be unsupported in a future version. Instead use unsubscribe function returned by subscribe. Everything will be garbage-collected if store is garbage-collected."
      );
    }
    listeners.clear();
  };
  const api = { setState, getState, subscribe, destroy };
  state = createState(setState, getState, api);
  return api;
};
var createStore = (createState) => createState ? createStoreImpl(createState) : createStoreImpl;

// node_modules/zustand/esm/middleware.mjs
var subscribeWithSelectorImpl = (fn) => (set2, get, api) => {
  const origSubscribe = api.subscribe;
  api.subscribe = (selector, optListener, options) => {
    let listener = selector;
    if (optListener) {
      const equalityFn = (options == null ? void 0 : options.equalityFn) || Object.is;
      let currentSlice = selector(api.getState());
      listener = (state) => {
        const nextSlice = selector(state);
        if (!equalityFn(currentSlice, nextSlice)) {
          const previousSlice = currentSlice;
          optListener(currentSlice = nextSlice, previousSlice);
        }
      };
      if (options == null ? void 0 : options.fireImmediately) {
        optListener(currentSlice, currentSlice);
      }
    }
    return origSubscribe(listener);
  };
  const initialState = fn(set2, get, api);
  return initialState;
};
var subscribeWithSelector = subscribeWithSelectorImpl;

// node_modules/immer/dist/immer.mjs
var NOTHING = Symbol.for("immer-nothing");
var DRAFTABLE = Symbol.for("immer-draftable");
var DRAFT_STATE = Symbol.for("immer-state");
var errors = true ? [
  // All error codes, starting by 0:
  function(plugin) {
    return `The plugin for '${plugin}' has not been loaded into Immer. To enable the plugin, import and call \`enable${plugin}()\` when initializing your application.`;
  },
  function(thing) {
    return `produce can only be called on things that are draftable: plain objects, arrays, Map, Set or classes that are marked with '[immerable]: true'. Got '${thing}'`;
  },
  "This object has been frozen and should not be mutated",
  function(data) {
    return "Cannot use a proxy that has been revoked. Did you pass an object from inside an immer function to an async process? " + data;
  },
  "An immer producer returned a new value *and* modified its draft. Either return a new value *or* modify the draft.",
  "Immer forbids circular references",
  "The first or second argument to `produce` must be a function",
  "The third argument to `produce` must be a function or undefined",
  "First argument to `createDraft` must be a plain object, an array, or an immerable object",
  "First argument to `finishDraft` must be a draft returned by `createDraft`",
  function(thing) {
    return `'current' expects a draft, got: ${thing}`;
  },
  "Object.defineProperty() cannot be used on an Immer draft",
  "Object.setPrototypeOf() cannot be used on an Immer draft",
  "Immer only supports deleting array indices",
  "Immer only supports setting array indices and the 'length' property",
  function(thing) {
    return `'original' expects a draft, got: ${thing}`;
  }
  // Note: if more errors are added, the errorOffset in Patches.ts should be increased
  // See Patches.ts for additional errors
] : [];
function die(error, ...args) {
  if (true) {
    const e = errors[error];
    const msg = typeof e === "function" ? e.apply(null, args) : e;
    throw new Error(`[Immer] ${msg}`);
  }
  throw new Error(
    `[Immer] minified error nr: ${error}. Full error at: https://bit.ly/3cXEKWf`
  );
}
var getPrototypeOf = Object.getPrototypeOf;
function isDraft(value) {
  return !!value && !!value[DRAFT_STATE];
}
function isDraftable(value) {
  if (!value)
    return false;
  return isPlainObject(value) || Array.isArray(value) || !!value[DRAFTABLE] || !!value.constructor?.[DRAFTABLE] || isMap(value) || isSet(value);
}
var objectCtorString = Object.prototype.constructor.toString();
function isPlainObject(value) {
  if (!value || typeof value !== "object")
    return false;
  const proto = getPrototypeOf(value);
  if (proto === null) {
    return true;
  }
  const Ctor = Object.hasOwnProperty.call(proto, "constructor") && proto.constructor;
  if (Ctor === Object)
    return true;
  return typeof Ctor == "function" && Function.toString.call(Ctor) === objectCtorString;
}
function each(obj, iter) {
  if (getArchtype(obj) === 0) {
    Reflect.ownKeys(obj).forEach((key) => {
      iter(key, obj[key], obj);
    });
  } else {
    obj.forEach((entry, index) => iter(index, entry, obj));
  }
}
function getArchtype(thing) {
  const state = thing[DRAFT_STATE];
  return state ? state.type_ : Array.isArray(thing) ? 1 : isMap(thing) ? 2 : isSet(thing) ? 3 : 0;
}
function has(thing, prop) {
  return getArchtype(thing) === 2 ? thing.has(prop) : Object.prototype.hasOwnProperty.call(thing, prop);
}
function set(thing, propOrOldValue, value) {
  const t = getArchtype(thing);
  if (t === 2)
    thing.set(propOrOldValue, value);
  else if (t === 3) {
    thing.add(value);
  } else
    thing[propOrOldValue] = value;
}
function is(x, y) {
  if (x === y) {
    return x !== 0 || 1 / x === 1 / y;
  } else {
    return x !== x && y !== y;
  }
}
function isMap(target) {
  return target instanceof Map;
}
function isSet(target) {
  return target instanceof Set;
}
function latest(state) {
  return state.copy_ || state.base_;
}
function shallowCopy(base, strict) {
  if (isMap(base)) {
    return new Map(base);
  }
  if (isSet(base)) {
    return new Set(base);
  }
  if (Array.isArray(base))
    return Array.prototype.slice.call(base);
  const isPlain = isPlainObject(base);
  if (strict === true || strict === "class_only" && !isPlain) {
    const descriptors = Object.getOwnPropertyDescriptors(base);
    delete descriptors[DRAFT_STATE];
    let keys = Reflect.ownKeys(descriptors);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const desc = descriptors[key];
      if (desc.writable === false) {
        desc.writable = true;
        desc.configurable = true;
      }
      if (desc.get || desc.set)
        descriptors[key] = {
          configurable: true,
          writable: true,
          // could live with !!desc.set as well here...
          enumerable: desc.enumerable,
          value: base[key]
        };
    }
    return Object.create(getPrototypeOf(base), descriptors);
  } else {
    const proto = getPrototypeOf(base);
    if (proto !== null && isPlain) {
      return { ...base };
    }
    const obj = Object.create(proto);
    return Object.assign(obj, base);
  }
}
function freeze(obj, deep = false) {
  if (isFrozen(obj) || isDraft(obj) || !isDraftable(obj))
    return obj;
  if (getArchtype(obj) > 1) {
    obj.set = obj.add = obj.clear = obj.delete = dontMutateFrozenCollections;
  }
  Object.freeze(obj);
  if (deep)
    Object.entries(obj).forEach(([key, value]) => freeze(value, true));
  return obj;
}
function dontMutateFrozenCollections() {
  die(2);
}
function isFrozen(obj) {
  return Object.isFrozen(obj);
}
var plugins = {};
function getPlugin(pluginKey) {
  const plugin = plugins[pluginKey];
  if (!plugin) {
    die(0, pluginKey);
  }
  return plugin;
}
var currentScope;
function getCurrentScope() {
  return currentScope;
}
function createScope(parent_, immer_) {
  return {
    drafts_: [],
    parent_,
    immer_,
    // Whenever the modified draft contains a draft from another scope, we
    // need to prevent auto-freezing so the unowned draft can be finalized.
    canAutoFreeze_: true,
    unfinalizedDrafts_: 0
  };
}
function usePatchesInScope(scope, patchListener) {
  if (patchListener) {
    getPlugin("Patches");
    scope.patches_ = [];
    scope.inversePatches_ = [];
    scope.patchListener_ = patchListener;
  }
}
function revokeScope(scope) {
  leaveScope(scope);
  scope.drafts_.forEach(revokeDraft);
  scope.drafts_ = null;
}
function leaveScope(scope) {
  if (scope === currentScope) {
    currentScope = scope.parent_;
  }
}
function enterScope(immer2) {
  return currentScope = createScope(currentScope, immer2);
}
function revokeDraft(draft) {
  const state = draft[DRAFT_STATE];
  if (state.type_ === 0 || state.type_ === 1)
    state.revoke_();
  else
    state.revoked_ = true;
}
function processResult(result, scope) {
  scope.unfinalizedDrafts_ = scope.drafts_.length;
  const baseDraft = scope.drafts_[0];
  const isReplaced = result !== void 0 && result !== baseDraft;
  if (isReplaced) {
    if (baseDraft[DRAFT_STATE].modified_) {
      revokeScope(scope);
      die(4);
    }
    if (isDraftable(result)) {
      result = finalize(scope, result);
      if (!scope.parent_)
        maybeFreeze(scope, result);
    }
    if (scope.patches_) {
      getPlugin("Patches").generateReplacementPatches_(
        baseDraft[DRAFT_STATE].base_,
        result,
        scope.patches_,
        scope.inversePatches_
      );
    }
  } else {
    result = finalize(scope, baseDraft, []);
  }
  revokeScope(scope);
  if (scope.patches_) {
    scope.patchListener_(scope.patches_, scope.inversePatches_);
  }
  return result !== NOTHING ? result : void 0;
}
function finalize(rootScope, value, path) {
  if (isFrozen(value))
    return value;
  const state = value[DRAFT_STATE];
  if (!state) {
    each(
      value,
      (key, childValue) => finalizeProperty(rootScope, state, value, key, childValue, path)
    );
    return value;
  }
  if (state.scope_ !== rootScope)
    return value;
  if (!state.modified_) {
    maybeFreeze(rootScope, state.base_, true);
    return state.base_;
  }
  if (!state.finalized_) {
    state.finalized_ = true;
    state.scope_.unfinalizedDrafts_--;
    const result = state.copy_;
    let resultEach = result;
    let isSet2 = false;
    if (state.type_ === 3) {
      resultEach = new Set(result);
      result.clear();
      isSet2 = true;
    }
    each(
      resultEach,
      (key, childValue) => finalizeProperty(rootScope, state, result, key, childValue, path, isSet2)
    );
    maybeFreeze(rootScope, result, false);
    if (path && rootScope.patches_) {
      getPlugin("Patches").generatePatches_(
        state,
        path,
        rootScope.patches_,
        rootScope.inversePatches_
      );
    }
  }
  return state.copy_;
}
function finalizeProperty(rootScope, parentState, targetObject, prop, childValue, rootPath, targetIsSet) {
  if (childValue === targetObject)
    die(5);
  if (isDraft(childValue)) {
    const path = rootPath && parentState && parentState.type_ !== 3 && // Set objects are atomic since they have no keys.
    !has(parentState.assigned_, prop) ? rootPath.concat(prop) : void 0;
    const res = finalize(rootScope, childValue, path);
    set(targetObject, prop, res);
    if (isDraft(res)) {
      rootScope.canAutoFreeze_ = false;
    } else
      return;
  } else if (targetIsSet) {
    targetObject.add(childValue);
  }
  if (isDraftable(childValue) && !isFrozen(childValue)) {
    if (!rootScope.immer_.autoFreeze_ && rootScope.unfinalizedDrafts_ < 1) {
      return;
    }
    finalize(rootScope, childValue);
    if ((!parentState || !parentState.scope_.parent_) && typeof prop !== "symbol" && Object.prototype.propertyIsEnumerable.call(targetObject, prop))
      maybeFreeze(rootScope, childValue);
  }
}
function maybeFreeze(scope, value, deep = false) {
  if (!scope.parent_ && scope.immer_.autoFreeze_ && scope.canAutoFreeze_) {
    freeze(value, deep);
  }
}
function createProxyProxy(base, parent) {
  const isArray = Array.isArray(base);
  const state = {
    type_: isArray ? 1 : 0,
    // Track which produce call this is associated with.
    scope_: parent ? parent.scope_ : getCurrentScope(),
    // True for both shallow and deep changes.
    modified_: false,
    // Used during finalization.
    finalized_: false,
    // Track which properties have been assigned (true) or deleted (false).
    assigned_: {},
    // The parent draft state.
    parent_: parent,
    // The base state.
    base_: base,
    // The base proxy.
    draft_: null,
    // set below
    // The base copy with any updated values.
    copy_: null,
    // Called by the `produce` function.
    revoke_: null,
    isManual_: false
  };
  let target = state;
  let traps = objectTraps;
  if (isArray) {
    target = [state];
    traps = arrayTraps;
  }
  const { revoke, proxy } = Proxy.revocable(target, traps);
  state.draft_ = proxy;
  state.revoke_ = revoke;
  return proxy;
}
var objectTraps = {
  get(state, prop) {
    if (prop === DRAFT_STATE)
      return state;
    const source = latest(state);
    if (!has(source, prop)) {
      return readPropFromProto(state, source, prop);
    }
    const value = source[prop];
    if (state.finalized_ || !isDraftable(value)) {
      return value;
    }
    if (value === peek(state.base_, prop)) {
      prepareCopy(state);
      return state.copy_[prop] = createProxy(value, state);
    }
    return value;
  },
  has(state, prop) {
    return prop in latest(state);
  },
  ownKeys(state) {
    return Reflect.ownKeys(latest(state));
  },
  set(state, prop, value) {
    const desc = getDescriptorFromProto(latest(state), prop);
    if (desc?.set) {
      desc.set.call(state.draft_, value);
      return true;
    }
    if (!state.modified_) {
      const current2 = peek(latest(state), prop);
      const currentState = current2?.[DRAFT_STATE];
      if (currentState && currentState.base_ === value) {
        state.copy_[prop] = value;
        state.assigned_[prop] = false;
        return true;
      }
      if (is(value, current2) && (value !== void 0 || has(state.base_, prop)))
        return true;
      prepareCopy(state);
      markChanged(state);
    }
    if (state.copy_[prop] === value && // special case: handle new props with value 'undefined'
    (value !== void 0 || prop in state.copy_) || // special case: NaN
    Number.isNaN(value) && Number.isNaN(state.copy_[prop]))
      return true;
    state.copy_[prop] = value;
    state.assigned_[prop] = true;
    return true;
  },
  deleteProperty(state, prop) {
    if (peek(state.base_, prop) !== void 0 || prop in state.base_) {
      state.assigned_[prop] = false;
      prepareCopy(state);
      markChanged(state);
    } else {
      delete state.assigned_[prop];
    }
    if (state.copy_) {
      delete state.copy_[prop];
    }
    return true;
  },
  // Note: We never coerce `desc.value` into an Immer draft, because we can't make
  // the same guarantee in ES5 mode.
  getOwnPropertyDescriptor(state, prop) {
    const owner = latest(state);
    const desc = Reflect.getOwnPropertyDescriptor(owner, prop);
    if (!desc)
      return desc;
    return {
      writable: true,
      configurable: state.type_ !== 1 || prop !== "length",
      enumerable: desc.enumerable,
      value: owner[prop]
    };
  },
  defineProperty() {
    die(11);
  },
  getPrototypeOf(state) {
    return getPrototypeOf(state.base_);
  },
  setPrototypeOf() {
    die(12);
  }
};
var arrayTraps = {};
each(objectTraps, (key, fn) => {
  arrayTraps[key] = function() {
    arguments[0] = arguments[0][0];
    return fn.apply(this, arguments);
  };
});
arrayTraps.deleteProperty = function(state, prop) {
  if (isNaN(parseInt(prop)))
    die(13);
  return arrayTraps.set.call(this, state, prop, void 0);
};
arrayTraps.set = function(state, prop, value) {
  if (prop !== "length" && isNaN(parseInt(prop)))
    die(14);
  return objectTraps.set.call(this, state[0], prop, value, state[0]);
};
function peek(draft, prop) {
  const state = draft[DRAFT_STATE];
  const source = state ? latest(state) : draft;
  return source[prop];
}
function readPropFromProto(state, source, prop) {
  const desc = getDescriptorFromProto(source, prop);
  return desc ? `value` in desc ? desc.value : (
    // This is a very special case, if the prop is a getter defined by the
    // prototype, we should invoke it with the draft as context!
    desc.get?.call(state.draft_)
  ) : void 0;
}
function getDescriptorFromProto(source, prop) {
  if (!(prop in source))
    return void 0;
  let proto = getPrototypeOf(source);
  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (desc)
      return desc;
    proto = getPrototypeOf(proto);
  }
  return void 0;
}
function markChanged(state) {
  if (!state.modified_) {
    state.modified_ = true;
    if (state.parent_) {
      markChanged(state.parent_);
    }
  }
}
function prepareCopy(state) {
  if (!state.copy_) {
    state.copy_ = shallowCopy(
      state.base_,
      state.scope_.immer_.useStrictShallowCopy_
    );
  }
}
var Immer2 = class {
  constructor(config) {
    this.autoFreeze_ = true;
    this.useStrictShallowCopy_ = false;
    this.produce = (base, recipe, patchListener) => {
      if (typeof base === "function" && typeof recipe !== "function") {
        const defaultBase = recipe;
        recipe = base;
        const self = this;
        return function curriedProduce(base2 = defaultBase, ...args) {
          return self.produce(base2, (draft) => recipe.call(this, draft, ...args));
        };
      }
      if (typeof recipe !== "function")
        die(6);
      if (patchListener !== void 0 && typeof patchListener !== "function")
        die(7);
      let result;
      if (isDraftable(base)) {
        const scope = enterScope(this);
        const proxy = createProxy(base, void 0);
        let hasError = true;
        try {
          result = recipe(proxy);
          hasError = false;
        } finally {
          if (hasError)
            revokeScope(scope);
          else
            leaveScope(scope);
        }
        usePatchesInScope(scope, patchListener);
        return processResult(result, scope);
      } else if (!base || typeof base !== "object") {
        result = recipe(base);
        if (result === void 0)
          result = base;
        if (result === NOTHING)
          result = void 0;
        if (this.autoFreeze_)
          freeze(result, true);
        if (patchListener) {
          const p = [];
          const ip = [];
          getPlugin("Patches").generateReplacementPatches_(base, result, p, ip);
          patchListener(p, ip);
        }
        return result;
      } else
        die(1, base);
    };
    this.produceWithPatches = (base, recipe) => {
      if (typeof base === "function") {
        return (state, ...args) => this.produceWithPatches(state, (draft) => base(draft, ...args));
      }
      let patches, inversePatches;
      const result = this.produce(base, recipe, (p, ip) => {
        patches = p;
        inversePatches = ip;
      });
      return [result, patches, inversePatches];
    };
    if (typeof config?.autoFreeze === "boolean")
      this.setAutoFreeze(config.autoFreeze);
    if (typeof config?.useStrictShallowCopy === "boolean")
      this.setUseStrictShallowCopy(config.useStrictShallowCopy);
  }
  createDraft(base) {
    if (!isDraftable(base))
      die(8);
    if (isDraft(base))
      base = current(base);
    const scope = enterScope(this);
    const proxy = createProxy(base, void 0);
    proxy[DRAFT_STATE].isManual_ = true;
    leaveScope(scope);
    return proxy;
  }
  finishDraft(draft, patchListener) {
    const state = draft && draft[DRAFT_STATE];
    if (!state || !state.isManual_)
      die(9);
    const { scope_: scope } = state;
    usePatchesInScope(scope, patchListener);
    return processResult(void 0, scope);
  }
  /**
   * Pass true to automatically freeze all copies created by Immer.
   *
   * By default, auto-freezing is enabled.
   */
  setAutoFreeze(value) {
    this.autoFreeze_ = value;
  }
  /**
   * Pass true to enable strict shallow copy.
   *
   * By default, immer does not copy the object descriptors such as getter, setter and non-enumrable properties.
   */
  setUseStrictShallowCopy(value) {
    this.useStrictShallowCopy_ = value;
  }
  applyPatches(base, patches) {
    let i;
    for (i = patches.length - 1; i >= 0; i--) {
      const patch = patches[i];
      if (patch.path.length === 0 && patch.op === "replace") {
        base = patch.value;
        break;
      }
    }
    if (i > -1) {
      patches = patches.slice(i + 1);
    }
    const applyPatchesImpl = getPlugin("Patches").applyPatches_;
    if (isDraft(base)) {
      return applyPatchesImpl(base, patches);
    }
    return this.produce(
      base,
      (draft) => applyPatchesImpl(draft, patches)
    );
  }
};
function createProxy(value, parent) {
  const draft = isMap(value) ? getPlugin("MapSet").proxyMap_(value, parent) : isSet(value) ? getPlugin("MapSet").proxySet_(value, parent) : createProxyProxy(value, parent);
  const scope = parent ? parent.scope_ : getCurrentScope();
  scope.drafts_.push(draft);
  return draft;
}
function current(value) {
  if (!isDraft(value))
    die(10, value);
  return currentImpl(value);
}
function currentImpl(value) {
  if (!isDraftable(value) || isFrozen(value))
    return value;
  const state = value[DRAFT_STATE];
  let copy;
  if (state) {
    if (!state.modified_)
      return state.base_;
    state.finalized_ = true;
    copy = shallowCopy(value, state.scope_.immer_.useStrictShallowCopy_);
  } else {
    copy = shallowCopy(value, true);
  }
  each(copy, (key, childValue) => {
    set(copy, key, currentImpl(childValue));
  });
  if (state) {
    state.finalized_ = false;
  }
  return copy;
}
var immer = new Immer2();
var produce = immer.produce;
var produceWithPatches = immer.produceWithPatches.bind(
  immer
);
var setAutoFreeze = immer.setAutoFreeze.bind(immer);
var setUseStrictShallowCopy = immer.setUseStrictShallowCopy.bind(immer);
var applyPatches = immer.applyPatches.bind(immer);
var createDraft = immer.createDraft.bind(immer);
var finishDraft = immer.finishDraft.bind(immer);

// node_modules/@deepseek-ai/dsh-client-store/lib/index.js
function notifySubscribers(listeners, label, ...args) {
  for (const listener of [...listeners]) try {
    listener(...args);
  } catch (error) {
    console.error(`${label} subscriber failed:`, error);
  }
}
function rafBatch(notify) {
  const schedule = typeof requestAnimationFrame === "function" ? (fn) => {
    requestAnimationFrame(() => {
      fn();
    });
  } : (fn) => {
    queueMicrotask(fn);
  };
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      notify();
    });
  };
}
function createSnapshotStore(init, opts) {
  const withSelector = subscribeWithSelector(() => init);
  const api = createStore()(withSelector);
  if (opts?.persist) attachPersistence(api, opts.persist.name);
  let subscribe = (fn) => api.subscribe(() => {
    notifySubscribers([fn], "[client-store]");
  });
  if (opts?.flush === "raf") {
    const listeners = /* @__PURE__ */ new Set();
    const flush = rafBatch(() => {
      notifySubscribers(listeners, "[client-store]");
    });
    api.subscribe(flush);
    subscribe = (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    };
  }
  return {
    getSnapshot: () => api.getState(),
    subscribe: (fn) => subscribe(fn),
    update: (mutator) => {
      api.setState(produce(api.getState(), (draft) => {
        mutator(draft);
      }), true);
    },
    set: (next) => {
      api.setState(devFreeze(next), true);
    }
  };
}
function attachPersistence(api, name) {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(name);
    if (raw !== null) api.setState(devFreeze(JSON.parse(raw)), true);
  } catch (error) {
    console.error(`snapshot store '${name}' rehydration failed:`, error);
  }
  api.subscribe((state) => {
    try {
      localStorage.setItem(name, JSON.stringify(state));
    } catch (error) {
      console.error(`snapshot store '${name}' persistence failed:`, error);
    }
  });
}
function devFreeze(value) {
  return freeze(value, true);
}

// vendor/dsh-input-controller/src/grammar.ts
function activeAtToken(line, cursorCol) {
  const beforeCursor = line.slice(0, cursorCol);
  const quoted = /(?:^|\s)(@"([^"]*))$/u.exec(beforeCursor);
  if (quoted?.[1] !== void 0 && quoted[2] !== void 0) {
    return { prefix: quoted[1], query: quoted[2], quoted: true };
  }
  const plain = /(?:^|\s)(@([^\s]*))$/u.exec(beforeCursor);
  if (plain?.[1] === void 0 || plain[2] === void 0) return void 0;
  return { prefix: plain[1], query: plain[2], quoted: false };
}

// vendor/dsh-input-controller/src/core/detect.ts
var WORD_CHAR = /[\p{L}\p{N}_]/u;
var WHITESPACE = /\s/u;
function boundaryOk(draft, index, char) {
  if (index === 0) return true;
  const prev = draft.charAt(index - 1);
  if (WHITESPACE.test(prev)) return true;
  if (WORD_CHAR.test(prev)) return false;
  if (char === "/") {
    if (prev === "/") return false;
    if (prev === ":" && index >= 2 && !WHITESPACE.test(draft.charAt(index - 2))) return false;
  }
  return true;
}
var detectTrigger = (draft, caret, guard) => {
  if (guard.tier === "frozen") return null;
  const at = activeAtToken(draft, caret);
  if (at !== void 0) {
    const start = caret - at.prefix.length;
    return {
      trigger: "@",
      query: at.query,
      quoted: at.quoted,
      position: draft.search(/\S/) === start ? "leading" : "inline",
      span: { start, end: caret, draftRev: 0 }
    };
  }
  for (let i = caret - 1; i >= 0; i--) {
    const ch = draft.charAt(i);
    if (WHITESPACE.test(ch)) return null;
    if (ch !== "/") continue;
    if (guard.tier === "claimed") continue;
    if (!boundaryOk(draft, i, ch)) continue;
    return {
      trigger: ch,
      query: draft.slice(i + 1, caret),
      quoted: false,
      position: draft.search(/\S/) === i ? "leading" : "inline",
      span: { start: i, end: caret, draftRev: 0 }
    };
  }
  return null;
};

// vendor/dsh-input-controller/src/core/menu.ts
var MENU_CLOSED = { open: false, hit: null, generation: 0, groups: [], highlight: null };
function seedGroups(state, sources) {
  return {
    ...state,
    groups: sources.map((source) => ({
      source: source.name,
      ...source.showGroupTitle === false ? { showGroupTitle: false } : {},
      status: "pending",
      items: []
    })),
    highlight: null
  };
}
var closed = (state) => state.open || state.hit !== null || state.groups.length > 0 || state.highlight !== null ? { open: false, hit: null, generation: state.generation, groups: [], highlight: null } : state;
function firstHighlight(groups) {
  for (const g of groups) {
    if (g.status === "ready" && g.items.length > 0) return { source: g.source, index: 0 };
  }
  return null;
}
function validHighlight(highlight, groups) {
  if (!highlight) return null;
  const g = groups.find((x) => x.source === highlight.source);
  return g && g.status === "ready" && highlight.index < g.items.length ? highlight : null;
}
function positions(groups) {
  const out = [];
  for (const g of groups) {
    if (g.status !== "ready") continue;
    for (let i = 0; i < g.items.length; i++) out.push({ source: g.source, index: i });
  }
  return out;
}
var allReadyEmpty = (groups) => groups.every((g) => g.status === "ready" && g.items.length === 0);
var menuReduce = (state, ev) => {
  switch (ev.type) {
    case "hit": {
      if (ev.hit === null) return closed(state);
      return {
        open: true,
        hit: ev.hit,
        generation: state.generation + 1,
        // Items and highlight survive the refinement (stale-while-revalidate):
        // the previous query's candidates stay rendered with the highlight
        // parked where it was while the new fetch runs, and the settled
        // generation replaces the items and revalidates the highlight
        // wholesale. Pending status still fences picks off the stale rows.
        groups: state.groups.map((g) => ({ ...g, status: "pending" })),
        highlight: state.highlight
      };
    }
    case "source-settled": {
      if (!state.open || ev.generation !== state.generation) return state;
      const idx = state.groups.findIndex((g) => g.source === ev.source);
      if (idx < 0) return state;
      const items = ev.items ?? [];
      const groups = state.groups.map((g, i) => i === idx ? { ...g, status: "ready", items } : g);
      if (allReadyEmpty(groups)) return closed(state);
      const highlight = validHighlight(state.highlight, groups) ?? firstHighlight(groups);
      return { ...state, groups, highlight };
    }
    case "source-failed": {
      if (!state.open || ev.generation !== state.generation) return state;
      if (!state.groups.some((g) => g.source === ev.source)) return state;
      const groups = state.groups.filter((g) => g.source !== ev.source);
      if (groups.length === 0 || allReadyEmpty(groups)) return closed(state);
      const highlight = validHighlight(state.highlight, groups) ?? firstHighlight(groups);
      return { ...state, groups, highlight };
    }
    case "move": {
      if (!state.open) return state;
      const pos = positions(state.groups);
      if (pos.length === 0) return state;
      const hl = state.highlight;
      const at = hl ? pos.findIndex((p) => p.source === hl.source && p.index === hl.index) : -1;
      const next = pos[at < 0 ? ev.dir === 1 ? 0 : pos.length - 1 : (at + ev.dir + pos.length) % pos.length];
      if (next === void 0) return state;
      if (hl && next.source === hl.source && next.index === hl.index) return state;
      return { ...state, highlight: next };
    }
    case "hover": {
      if (!state.open) return state;
      const target = validHighlight({ source: ev.source, index: ev.index }, state.groups);
      if (target === null) return state;
      const hl = state.highlight;
      if (hl && hl.source === target.source && hl.index === target.index) return state;
      return { ...state, highlight: target };
    }
    case "close":
      return closed(state);
  }
};

// vendor/dsh-input-controller/src/client/controller.ts
function dismissedHit(dismissed, hit) {
  return dismissed.trigger === hit.trigger && dismissed.query === hit.query && dismissed.quoted === hit.quoted && dismissed.start === hit.span.start && dismissed.end === hit.span.end;
}
var InputTriggerController = class {
  constructor(deps) {
    this.deps = deps;
    const projection = this.project();
    for (const src of deps.roster.all()) {
      src.warm?.(projection);
      this.watchLexicon(src, projection);
    }
    this.refreshLexicon();
  }
  /** Menu state store (per-session; survives session switches, dies with the scope). */
  menu = createSnapshotStore(MENU_CLOSED);
  /**
   * Name of the source opened through the programmatic launcher, or null for
   * trigger-detected/closed menus. Composer chrome subscribes to this store
   * for the launcher's expanded state without owning a second menu model.
   */
  launcher = createSnapshotStore(null);
  /**
   * Crumbs published by each header-bearing source for the open menu, keyed
   * by source name. A snapshot store like {@link InputTriggerController.launcher}:
   * the answer changes with every hit, and render-side consumers subscribe
   * instead of re-polling sources during a render.
   */
  headers = createSnapshotStore(/* @__PURE__ */ new Map());
  /**
   * Aggregated hot reference lexicon, grouped by trigger (plain-text-reference decision;
   * see .agents/notes/archived/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md):
   * sources implementing the lexicon hook are polled with the session
   * projection; undefined answers (roll not hot yet) are skipped; multiple
   * sources on one trigger concatenate in registration order. A snapshot
   * store because rolls change asynchronously (catalog settles, children
   * spawn/exit) — render-side consumers subscribe instead of re-reading a
   * mutable answer.
   */
  lexicon = createSnapshotStore(/* @__PURE__ */ new Map());
  /** The authoritative hit: single truth for span CAS material (menu snapshot never carries it alone). */
  hit = null;
  /**
   * Identity of the hit whose menu the user dismissed. A dismissal means "not
   * this one, not now": the same token with the same query keeps its menu
   * closed, so restoring the caret after a dismissal cannot reopen it. Typing
   * (a new query) or moving to another token clears it.
   */
  dismissed = null;
  /** Whether the open menu was reached by a drill pick; cleared with the menu. */
  drilled = false;
  fetch = null;
  disposed = false;
  /** Per-source lexicon unsubscribers (sources without the hook never enter). */
  lexiconOffs = /* @__PURE__ */ new Map();
  /**
   * Feed a draft/caret change through trigger detection and drive the menu.
   * @param draft - full draft text.
   * @param caret - caret offset into `draft`.
   * @param guard - availability tier derived from the input phase.
   * @param draftRev - the input machine's current draft revision, stamped
   * into the hit span for pick-time CAS.
   */
  track(draft, caret, guard, draftRev) {
    if (this.disposed) return;
    const launched = this.launcher.getSnapshot() !== null;
    this.clearLauncher();
    const raw = detectTrigger(draft, caret, guard);
    if (raw === null) {
      if (launched) return;
      this.hit = null;
      if (guard.tier !== "frozen") this.dismissed = null;
      this.stopFetch();
      this.reduce({ type: "close" });
      return;
    }
    const hit = { ...raw, span: { ...raw.span, draftRev } };
    if (launched) this.dismissed = null;
    if (this.dismissed !== null) {
      if (!dismissedHit(this.dismissed, hit)) this.dismissed = null;
      else {
        this.hit = hit;
        return;
      }
    }
    const prev = this.menu.getSnapshot();
    const same = !launched && prev.open && prev.hit !== null && prev.hit.trigger === hit.trigger && prev.hit.query === hit.query && prev.hit.quoted === hit.quoted && prev.hit.span.start === hit.span.start && prev.hit.span.end === hit.span.end;
    this.hit = hit;
    if (same) return;
    const roster = this.deps.roster.sources(hit.trigger);
    if (roster.length === 0) {
      this.stopFetch();
      this.reduce({ type: "close" });
      return;
    }
    if (launched || !prev.open || prev.hit === null || prev.hit.trigger !== hit.trigger) {
      this.menu.set(seedGroups(this.menu.getSnapshot(), roster));
    }
    this.reduce({ type: "hit", hit });
    this.refreshHeaders(hit, roster);
    this.fetchCandidates(hit, roster);
  }
  /**
   * Toggle a menu containing exactly one registered source. The supplied hit
   * is a synthetic selection span rather than a typed trigger token, but
   * picks deliberately reuse the ordinary source callback and scoped input
   * mutation pipeline.
   * @param source - registered source name under `hit.trigger`.
   * @param hit - synthetic hit carrying position and pick-time draft CAS.
   */
  toggleSource(source, hit) {
    if (this.disposed) return;
    if (this.launcher.getSnapshot() === source && this.menu.getSnapshot().open) {
      this.dismiss();
      return;
    }
    const match = this.deps.roster.sources(hit.trigger).find((item) => item.name === source);
    if (match === void 0) {
      this.dismiss();
      return;
    }
    this.stopFetch();
    this.hit = hit;
    this.launcher.set(source);
    this.menu.set(seedGroups(this.menu.getSnapshot(), [match]));
    this.reduce({ type: "hit", hit });
    this.refreshHeaders(hit, [match]);
    this.fetchCandidates(hit, [match]);
  }
  /**
   * Pointer pick from MenuView: route the clicked candidate through onPick
   * and execute claim/insert outcomes via the scoped input events.
   * @param source - source (group) name.
   * @param index - candidate index within the group.
   * @param action - settling pick (default) or the candidate's drill action.
   */
  pick(source, index, action = "pick") {
    const state = this.menu.getSnapshot();
    const hit = this.hit;
    if (this.disposed || !state.open || hit === null) return;
    const group = state.groups.find((g) => g.source === source);
    const candidate = group !== void 0 && group.status === "ready" ? group.items[index] : void 0;
    if (candidate === void 0) return;
    const src = this.deps.roster.sources(hit.trigger).find((s) => s.name === source);
    if (src === void 0) return;
    this.settle(src, candidate, hit, action);
  }
  /**
   * Pointer pick on one crumb of a source's menu header: route it through the
   * same drill path a folder row takes, so returning to a step and descending
   * into one share one outcome.
   * @param source - source (group) name.
   * @param index - crumb index within that source's published header.
   */
  pickCrumb(source, index) {
    const hit = this.hit;
    if (this.disposed || !this.menu.getSnapshot().open || hit === null) return;
    const crumb = this.headers.getSnapshot().get(source)?.[index];
    if (crumb === void 0 || crumb.current === true) return;
    const src = this.deps.roster.sources(hit.trigger).find((s) => s.name === source);
    if (src === void 0) return;
    this.settle(src, { name: crumb.label, value: crumb.value }, hit, "drill");
  }
  /**
   * Pointer hover from MenuView: park the shared highlight on the hovered
   * candidate (keyboard `move` and pointer hover drive one highlight —
   * last input wins).
   * @param source - source (group) name.
   * @param index - candidate index within the group.
   */
  hover(source, index) {
    if (this.disposed) return;
    this.reduce({ type: "hover", source, index });
  }
  /**
   * Keyboard arbitration while the menu is open.
   * @param key - intercepted key.
   * @param composing - inside IME composition: everything passes.
   * @returns `pass` when the browser keeps the key (closed menu, no
   * highlight, or a vanished candidate), `consumed` when the menu handled
   * the key without a settling pick (move, close, drill descent, or a
   * pending-refinement no-op), or `pick-highlighted` when the highlighted
   * candidate settled and the menu closed.
   */
  arbitrate(key, composing) {
    if (composing || this.disposed) return "pass";
    const state = this.menu.getSnapshot();
    if (!state.open) return "pass";
    switch (key) {
      case "up": {
        this.reduce({ type: "move", dir: -1 });
        return "consumed";
      }
      case "down": {
        this.reduce({ type: "move", dir: 1 });
        return "consumed";
      }
      case "escape":
      case "tabBack": {
        this.rememberDismissed();
        this.stopFetch();
        this.reduce({ type: "close" });
        return "consumed";
      }
      case "enter": {
        if (state.highlight === null) return "pass";
        const group = state.groups.find((g) => g.source === state.highlight?.source);
        if (group === void 0 || group.status !== "ready") return "consumed";
        this.pick(state.highlight.source, state.highlight.index);
        return "pick-highlighted";
      }
      case "tab": {
        if (state.highlight === null) return "pass";
        const group = state.groups.find((g) => g.source === state.highlight?.source);
        if (group === void 0 || group.status !== "ready") return "consumed";
        const item = group.items[state.highlight.index];
        if (item === void 0) return "pass";
        if (item.drill === true) {
          this.pick(state.highlight.source, state.highlight.index, "drill");
          return "consumed";
        }
        this.pick(state.highlight.source, state.highlight.index);
        return "pick-highlighted";
      }
    }
  }
  /**
   * Space adjudication over the just-completed leading token: polls sources'
   * matchSpace (hot state, synchronous) and dispatches the outcome itself.
   * @returns true when a claim/insert was actually applied by the input —
   * the caller preventDefaults exactly then.
   */
  onSpace() {
    const hit = this.hit;
    if (this.disposed || hit === null || hit.position !== "leading") return false;
    const token = hit.trigger + hit.query;
    const projection = this.project();
    for (const src of this.deps.roster.sources(hit.trigger)) {
      if (src.matchSpace === void 0) continue;
      const outcome = src.matchSpace(projection, token);
      if (outcome === void 0) continue;
      if (outcome === "handled") return true;
      return this.execute(outcome, hit.span);
    }
    return false;
  }
  /**
   * Serialize one reference occurrence to its model form via the owning
   * source's codec (prompt serialization: registry → explicit
   * call → await). Owner missing or codec-less rejects — the submit attempt
   * blocks instead of silently downgrading to the clipboard text.
   * @param source - owning source name.
   * @param ref - owner-scoped reference id.
   * @param signal - the submit attempt's abort signal.
   * @returns the model representation (e.g. `<skill>name</skill>`).
   */
  serializeReference(source, ref, signal) {
    const owner = this.deps.roster.all().find((s) => s.name === source);
    if (owner?.codec === void 0) {
      return Promise.reject(new Error(`slash: no serializer for reference source "${source}"`));
    }
    return owner.codec.serialize(ref, signal);
  }
  /**
   * Route a chip to its owner or an editable token to its current lexicon owner.
   * @param source - chip source name; undefined for editable text.
   * @param reference - source-owned id and optional chip glyph.
   * @returns whether an owner accepted the preview, possibly awaiting its catalog.
   */
  openReference(source, reference) {
    if (this.disposed) return false;
    const session = this.project();
    for (const owner of this.deps.roster.all()) {
      const matches = source === void 0 ? reference.ref.startsWith(owner.trigger) && owner.lexicon?.(session)?.includes(reference.ref.slice(1)) : owner.name === source;
      if (matches && owner.openReference?.(session, reference)) {
        this.dismiss();
        return true;
      }
    }
    return false;
  }
  /**
   * Enter last adjudication: polls sources' matchEnter in registration
   * order, first non-undefined wins. The outcome returns to the caller (the
   * input machine applies it inside the same submit attempt — no event).
   * @param line - trimmed draft; the leading char selects the trigger roster.
   * @param signal - attempt-scoped abort from the input machine.
   * @param envelope - non-text submission state accompanying the draft.
   * @returns the winning outcome or undefined (default sink). Rejects when a
   * polled source's warmup fails or the winning source refuses the envelope —
   * the caller must not silently downgrade.
   */
  async adjudicate(line, signal, envelope) {
    const projection = this.project();
    for (const src of this.deps.roster.all()) {
      if (signal.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error("slash adjudication aborted");
      }
      if (src.matchEnter === void 0 || !line.startsWith(src.trigger)) continue;
      const outcome = await src.matchEnter(projection, line, signal, envelope);
      if (outcome !== void 0) return outcome;
    }
    return void 0;
  }
  /**
   * Drop the menu group of a disposed source (root registry change notification).
   * @param source - the source whose registration was disposed.
   */
  sourceRemoved(source) {
    const state = this.menu.getSnapshot();
    if (state.open && state.hit !== null && state.hit.trigger === source.trigger) {
      this.reduce({ type: "source-failed", generation: state.generation, source: source.name });
    }
    this.lexiconOffs.get(source)?.();
    this.lexiconOffs.delete(source);
    this.refreshLexicon();
  }
  /**
   * Admit a source registered after this controller's birth (root registry
   * change notification): warm it and fold its roll into the live lexicon —
   * the constructor-time prewarm covers only the roster present at scope
   * birth.
   * @param source - the newly registered source.
   */
  sourceAdded(source) {
    const projection = this.project();
    source.warm?.(projection);
    this.watchLexicon(source, projection);
    this.refreshLexicon();
  }
  /** External dismiss (e.g. pointer outside the composer area). */
  dismiss() {
    if (this.disposed) return;
    this.rememberDismissed();
    this.stopFetch();
    this.reduce({ type: "close" });
  }
  /** Re-fetch the currently open menu without changing its hit or visible rows. */
  refreshOpenMenu() {
    if (this.disposed || !this.menu.getSnapshot().open || this.hit === null) return;
    const launched = this.launcher.getSnapshot();
    const roster = this.deps.roster.sources(this.hit.trigger).filter((source) => launched === null || source.name === launched);
    if (roster.length === 0) return;
    this.fetchCandidates(this.hit, roster);
  }
  /** Scope teardown: close and abort (the service deletes the map entry). */
  dispose() {
    this.disposed = true;
    this.stopFetch();
    this.reduce({ type: "close" });
    this.hit = null;
    for (const off of this.lexiconOffs.values()) off();
    this.lexiconOffs.clear();
  }
  /** The session projection handed to sources (agent-backed identity; constant per scope). */
  project() {
    return { sessionId: this.deps.sessionId };
  }
  /** Execute a claim/insert/text outcome via the scoped input events (actx as dispatch subject); true = the input applied it. */
  execute(outcome, span) {
    const { actx } = this.deps;
    if (outcome === void 0 || outcome === "handled") return false;
    if ("claim" in outcome) {
      return actx.bail(actx, "slash/input-begin-command", { claim: outcome.claim, span }) === true;
    }
    if ("text" in outcome) {
      return actx.bail(actx, "slash/input-insert-text", {
        text: outcome.text,
        span,
        ...outcome.continue === true ? { continue: true } : {}
      }) === true;
    }
    return actx.bail(actx, "slash/input-insert-reference", { reference: outcome.insert, span }) === true;
  }
  /** Re-poll every lexicon-bearing source and publish the aggregated rolls (see the store doc). */
  refreshLexicon() {
    const projection = this.project();
    const rolls = /* @__PURE__ */ new Map();
    for (const src of this.deps.roster.all()) {
      if (src.lexicon === void 0) continue;
      let names;
      try {
        names = src.lexicon(projection);
      } catch (error) {
        console.error(`[ui-input-trigger] source "${src.name}" lexicon failed:`, error);
        continue;
      }
      if (names === void 0) continue;
      const prev = rolls.get(src.trigger);
      rolls.set(src.trigger, prev === void 0 ? names : [...prev, ...names]);
    }
    this.lexicon.set(rolls);
  }
  /** Wire one source's lexicon invalidation channel into refresh (hookless or roll-less sources never notify). */
  watchLexicon(source, projection) {
    if (source.lexicon === void 0 || source.subscribeLexicon === void 0) return;
    this.lexiconOffs.set(source, source.subscribeLexicon(projection, () => {
      this.refreshLexicon();
      const hit = this.hit;
      if (hit === null || !this.menu.getSnapshot().open || hit.trigger !== source.trigger) return;
      void Promise.resolve().then(() => {
        if (this.disposed || this.hit !== hit || !this.menu.getSnapshot().open) return;
        this.fetchCandidates(hit, this.deps.roster.sources(hit.trigger));
      });
    }));
  }
  /** Launch the candidate fetch for one hit generation, superseding the previous one. */
  fetchCandidates(hit, roster) {
    this.stopFetch();
    const controller = new AbortController();
    this.fetch = controller;
    const generation = this.menu.getSnapshot().generation;
    const projection = this.project();
    for (const source of roster) {
      void source.candidates(projection, {
        query: hit.query,
        quoted: hit.quoted,
        position: hit.position,
        drilled: this.drilled,
        signal: controller.signal
      }).then(
        (items) => {
          if (controller.signal.aborted) return;
          this.reduce({ type: "source-settled", generation, source: source.name, items });
        },
        (error) => {
          if (controller.signal.aborted) return;
          console.error(`[ui-input-trigger] source "${source.name}" candidates failed:`, error);
          this.reduce({ type: "source-failed", generation, source: source.name });
        }
      );
    }
  }
  stopFetch() {
    this.fetch?.abort();
    this.fetch = null;
  }
  /**
   * Run one candidate (or crumb) through its source and apply the outcome.
   *
   * A drill is the one pick that leaves the menu open, so it is also the one
   * that records how the next query was reached; every other pick closes the
   * menu, which clears that record.
   * @param src - the owning source.
   * @param candidate - the picked candidate, or a crumb projected as one.
   * @param hit - the authoritative hit supplying position and span CAS.
   * @param action - settling pick or drill.
   */
  settle(src, candidate, hit, action) {
    const outcome = src.onPick({
      candidate,
      session: this.project(),
      position: hit.position,
      via: "menu",
      action,
      span: hit.span
    });
    this.stopFetch();
    if (action === "pick") this.rememberDismissed();
    this.reduce({ type: "close" });
    this.drilled = action === "drill";
    if (!this.execute(outcome, hit.span)) this.drilled = false;
  }
  /** Re-poll every header-bearing source in the hit roster and publish their crumbs. */
  refreshHeaders(hit, roster) {
    const projection = this.project();
    const crumbs = /* @__PURE__ */ new Map();
    for (const src of roster) {
      if (src.header === void 0) continue;
      let published;
      try {
        published = src.header(projection, { query: hit.query, quoted: hit.quoted, drilled: this.drilled });
      } catch (error) {
        console.error(`[ui-input-trigger] source "${src.name}" header failed:`, error);
        continue;
      }
      if (published === void 0 || published.length === 0) continue;
      crumbs.set(src.name, published);
    }
    this.setHeaders(crumbs);
  }
  setHeaders(next) {
    if (this.headers.getSnapshot().size === 0 && next.size === 0) return;
    this.headers.set(next);
  }
  /** Record the open menu's identity as dismissed, so a bare re-track cannot revive it. */
  rememberDismissed() {
    const hit = this.hit;
    this.dismissed = hit === null ? null : {
      trigger: hit.trigger,
      query: hit.query,
      quoted: hit.quoted,
      start: hit.span.start,
      end: hit.span.end
    };
  }
  clearLauncher() {
    if (this.launcher.getSnapshot() !== null) this.launcher.set(null);
  }
  reduce(ev) {
    const cur = this.menu.getSnapshot();
    const next = menuReduce(cur, ev);
    if (next !== cur) this.menu.set(next);
    if (next.open) return;
    this.clearLauncher();
    this.drilled = false;
    this.setHeaders(/* @__PURE__ */ new Map());
  }
};
export {
  InputTriggerController,
  detectTrigger
};
