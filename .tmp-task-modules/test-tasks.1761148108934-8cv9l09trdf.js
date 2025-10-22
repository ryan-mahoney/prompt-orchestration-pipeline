export const validateStructure = function(...s) {
    let n = T(t);
    n.called = !0, n.callCount++, n.calls.push(s);
    let d = n.next.shift();
    if (d) {
      n.results.push(d);
      let [a, i] = d;
      if (a === "ok")
        return i;
      throw i;
    }
    let o, c = "ok", p = n.results.length;
    if (n.impl)
      try {
        new.target ? o = Reflect.construct(n.impl, s, new.target) : o = n.impl.apply(this, s), c = "ok";
      } catch (a) {
        throw o = a, c = "error", n.results.push([c, a]), a;
      }
    let g = [c, o];
    return w(o) && o.then(
      (a) => n.resolves[p] = ["ok", a],
      (a) => n.resolves[p] = ["error", a]
    ), n.results.push(g), o;
  };
export const critique = function(...s) {
    let n = T(t);
    n.called = !0, n.callCount++, n.calls.push(s);
    let d = n.next.shift();
    if (d) {
      n.results.push(d);
      let [a, i] = d;
      if (a === "ok")
        return i;
      throw i;
    }
    let o, c = "ok", p = n.results.length;
    if (n.impl)
      try {
        new.target ? o = Reflect.construct(n.impl, s, new.target) : o = n.impl.apply(this, s), c = "ok";
      } catch (a) {
        throw o = a, c = "error", n.results.push([c, a]), a;
      }
    let g = [c, o];
    return w(o) && o.then(
      (a) => n.resolves[p] = ["ok", a],
      (a) => n.resolves[p] = ["error", a]
    ), n.results.push(g), o;
  };
export const refine = function(...s) {
    let n = T(t);
    n.called = !0, n.callCount++, n.calls.push(s);
    let d = n.next.shift();
    if (d) {
      n.results.push(d);
      let [a, i] = d;
      if (a === "ok")
        return i;
      throw i;
    }
    let o, c = "ok", p = n.results.length;
    if (n.impl)
      try {
        new.target ? o = Reflect.construct(n.impl, s, new.target) : o = n.impl.apply(this, s), c = "ok";
      } catch (a) {
        throw o = a, c = "error", n.results.push([c, a]), a;
      }
    let g = [c, o];
    return w(o) && o.then(
      (a) => n.resolves[p] = ["ok", a],
      (a) => n.resolves[p] = ["error", a]
    ), n.results.push(g), o;
  };
export const ingestion = function(...s) {
    let n = T(t);
    n.called = !0, n.callCount++, n.calls.push(s);
    let d = n.next.shift();
    if (d) {
      n.results.push(d);
      let [a, i] = d;
      if (a === "ok")
        return i;
      throw i;
    }
    let o, c = "ok", p = n.results.length;
    if (n.impl)
      try {
        new.target ? o = Reflect.construct(n.impl, s, new.target) : o = n.impl.apply(this, s), c = "ok";
      } catch (a) {
        throw o = a, c = "error", n.results.push([c, a]), a;
      }
    let g = [c, o];
    return w(o) && o.then(
      (a) => n.resolves[p] = ["ok", a],
      (a) => n.resolves[p] = ["error", a]
    ), n.results.push(g), o;
  };
export const preProcessing = function(...s) {
    let n = T(t);
    n.called = !0, n.callCount++, n.calls.push(s);
    let d = n.next.shift();
    if (d) {
      n.results.push(d);
      let [a, i] = d;
      if (a === "ok")
        return i;
      throw i;
    }
    let o, c = "ok", p = n.results.length;
    if (n.impl)
      try {
        new.target ? o = Reflect.construct(n.impl, s, new.target) : o = n.impl.apply(this, s), c = "ok";
      } catch (a) {
        throw o = a, c = "error", n.results.push([c, a]), a;
      }
    let g = [c, o];
    return w(o) && o.then(
      (a) => n.resolves[p] = ["ok", a],
      (a) => n.resolves[p] = ["error", a]
    ), n.results.push(g), o;
  };
export const promptTemplating = function(...s) {
    let n = T(t);
    n.called = !0, n.callCount++, n.calls.push(s);
    let d = n.next.shift();
    if (d) {
      n.results.push(d);
      let [a, i] = d;
      if (a === "ok")
        return i;
      throw i;
    }
    let o, c = "ok", p = n.results.length;
    if (n.impl)
      try {
        new.target ? o = Reflect.construct(n.impl, s, new.target) : o = n.impl.apply(this, s), c = "ok";
      } catch (a) {
        throw o = a, c = "error", n.results.push([c, a]), a;
      }
    let g = [c, o];
    return w(o) && o.then(
      (a) => n.resolves[p] = ["ok", a],
      (a) => n.resolves[p] = ["error", a]
    ), n.results.push(g), o;
  };
export const inference = function(...s) {
    let n = T(t);
    n.called = !0, n.callCount++, n.calls.push(s);
    let d = n.next.shift();
    if (d) {
      n.results.push(d);
      let [a, i] = d;
      if (a === "ok")
        return i;
      throw i;
    }
    let o, c = "ok", p = n.results.length;
    if (n.impl)
      try {
        new.target ? o = Reflect.construct(n.impl, s, new.target) : o = n.impl.apply(this, s), c = "ok";
      } catch (a) {
        throw o = a, c = "error", n.results.push([c, a]), a;
      }
    let g = [c, o];
    return w(o) && o.then(
      (a) => n.resolves[p] = ["ok", a],
      (a) => n.resolves[p] = ["error", a]
    ), n.results.push(g), o;
  };
export const parsing = function(...s) {
    let n = T(t);
    n.called = !0, n.callCount++, n.calls.push(s);
    let d = n.next.shift();
    if (d) {
      n.results.push(d);
      let [a, i] = d;
      if (a === "ok")
        return i;
      throw i;
    }
    let o, c = "ok", p = n.results.length;
    if (n.impl)
      try {
        new.target ? o = Reflect.construct(n.impl, s, new.target) : o = n.impl.apply(this, s), c = "ok";
      } catch (a) {
        throw o = a, c = "error", n.results.push([c, a]), a;
      }
    let g = [c, o];
    return w(o) && o.then(
      (a) => n.resolves[p] = ["ok", a],
      (a) => n.resolves[p] = ["error", a]
    ), n.results.push(g), o;
  };
export const validateQuality = function(...s) {
    let n = T(t);
    n.called = !0, n.callCount++, n.calls.push(s);
    let d = n.next.shift();
    if (d) {
      n.results.push(d);
      let [a, i] = d;
      if (a === "ok")
        return i;
      throw i;
    }
    let o, c = "ok", p = n.results.length;
    if (n.impl)
      try {
        new.target ? o = Reflect.construct(n.impl, s, new.target) : o = n.impl.apply(this, s), c = "ok";
      } catch (a) {
        throw o = a, c = "error", n.results.push([c, a]), a;
      }
    let g = [c, o];
    return w(o) && o.then(
      (a) => n.resolves[p] = ["ok", a],
      (a) => n.resolves[p] = ["error", a]
    ), n.results.push(g), o;
  };
export const finalValidation = function(...s) {
    let n = T(t);
    n.called = !0, n.callCount++, n.calls.push(s);
    let d = n.next.shift();
    if (d) {
      n.results.push(d);
      let [a, i] = d;
      if (a === "ok")
        return i;
      throw i;
    }
    let o, c = "ok", p = n.results.length;
    if (n.impl)
      try {
        new.target ? o = Reflect.construct(n.impl, s, new.target) : o = n.impl.apply(this, s), c = "ok";
      } catch (a) {
        throw o = a, c = "error", n.results.push([c, a]), a;
      }
    let g = [c, o];
    return w(o) && o.then(
      (a) => n.resolves[p] = ["ok", a],
      (a) => n.resolves[p] = ["error", a]
    ), n.results.push(g), o;
  };
export const integration = function(...s) {
    let n = T(t);
    n.called = !0, n.callCount++, n.calls.push(s);
    let d = n.next.shift();
    if (d) {
      n.results.push(d);
      let [a, i] = d;
      if (a === "ok")
        return i;
      throw i;
    }
    let o, c = "ok", p = n.results.length;
    if (n.impl)
      try {
        new.target ? o = Reflect.construct(n.impl, s, new.target) : o = n.impl.apply(this, s), c = "ok";
      } catch (a) {
        throw o = a, c = "error", n.results.push([c, a]), a;
      }
    let g = [c, o];
    return w(o) && o.then(
      (a) => n.resolves[p] = ["ok", a],
      (a) => n.resolves[p] = ["error", a]
    ), n.results.push(g), o;
  };
export default { validateStructure, critique, refine };