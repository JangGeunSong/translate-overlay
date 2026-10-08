// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { measureSurface } from "../src/content/overlay/surfaceLayout";
import { OverlayRenderer } from "../src/content/overlay/overlayRenderer";
import type { TextRegion } from "../src/content/types";

const rect = (left = 20.25, top = 30.5, width = 200.5, height = 48) => new DOMRect(left, top, width, height);
let source: HTMLElement;
let shadow: ShadowRoot;
beforeEach(() => {
  document.body.innerHTML = '<main style="background:rgb(230, 240, 250)"><h1 style="font-size:20px;color:rgb(20,30,40)">A multiline product title</h1></main>';
  source = document.querySelector('h1')!;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect(10, 20, 300, 100));
  vi.spyOn(document, 'createRange').mockImplementation(() => ({
    selectNodeContents() {}, getClientRects: () => [rect()],
  }) as unknown as Range);
  const attach = HTMLElement.prototype.attachShadow;
  vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(function (this: HTMLElement, init) {
    shadow = attach.call(this, init); return shadow;
  });
});
afterEach(() => {
  document.querySelector('[data-context-reader-root]')?.remove();
  vi.restoreAllMocks();
});

describe('bounded read-only text surface layout', () => {
  it('uses available content bounds and an opaque inherited background, excluding padding', () => {
    const before = document.body.innerHTML;
    expect(measureSurface(source)).toEqual({box: {
      left:10, top:20, right:310, bottom:120, width:300, height:100,
    }, background:'rgb(230, 240, 250)'});
    expect(document.body.innerHTML).toBe(before);
  });

  it.each([
    ['background-image:linear-gradient(red, blue)', 'uncertain-background'],
    ['background-color:rgba(0,0,0,0.5)', 'uncertain-background'],
    ['transform:rotate(2deg)', 'complex-geometry'],
    ['clip-path:circle(50%)', 'complex-geometry'],
    ['opacity:0.5', 'complex-geometry'],
  ])('keeps uncertain ancestor styles original: %s', (css, reason) => {
    source.parentElement!.style.cssText = css;
    expect(measureSurface(source)).toEqual({reason});
  });

  it('rejects source overflow, partial ancestor clips, and offscreen text', () => {
    vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(rect(30, 20, 80, 30));
    vi.spyOn(source.parentElement!, 'getBoundingClientRect').mockReturnValue(rect(30, 20, 80, 30));
    expect(measureSurface(source)).toEqual({reason:'source-overflow'});
    vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 400, 200));
    vi.spyOn(source.parentElement!, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 400, 200));
    const parent = source.parentElement!;
    parent.style.overflowX = 'hidden';
    Object.defineProperty(parent, 'clientWidth', {configurable:true, value:100});
    expect(measureSurface(source)).toEqual({reason:'ancestor-clip'});
    Object.defineProperty(parent, 'clientWidth', {configurable:true, value:300});
    expect(measureSurface(source)).toHaveProperty('box');
    vi.spyOn(document, 'createRange').mockReturnValue({selectNodeContents() {}, getClientRects:() => [rect(-1,30,50,30)]} as unknown as Range);
    vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(rect(-10, 0, 400, 200));
    expect(measureSurface(source)).toEqual({reason:'viewport-clip'});
  });

  it('rejects mixed controls and overlapping neighbours', () => {
    source.innerHTML += '<input value="private">';
    expect(measureSurface(source)).toEqual({reason:'mixed-geometry'});
    source.querySelector('input')!.remove();
    Object.defineProperty(document, 'elementFromPoint', {configurable:true, value:() => document.createElement('span')});
    expect(measureSurface(source)).toEqual({reason:'occluded'});
    delete (document as unknown as {elementFromPoint?:unknown}).elementFromPoint;
  });

  it('protects overlapping neighbour boxes even when they ignore pointer hit testing', () => {
    const value = document.createElement('span');
    value.textContent = 'USD 129'; value.style.pointerEvents = 'none';
    source.after(value);
    vi.spyOn(value, 'getBoundingClientRect').mockReturnValue(rect(40,40,30,20));
    expect(measureSurface(source)).toEqual({reason:'overlapping-neighbour'});
  });

  function render(semanticClass: TextRegion['semanticClass'] = 'UI') {
    const renderer = new OverlayRenderer(() => {});
    const region: TextRegion = {id:'r', sourceKey:'s', element:source, text:source.textContent!, language:'en',
      semanticClass, viewportBand:'VIEWPORT', translationPriority:0, rect:source.getBoundingClientRect()};
    renderer.reconcile([region], new Map([['r', {regionId:'r', requestKey:'q', translatedText:'여러 줄 상품 제목', provider:'test'}]]));
    return {renderer, surface:shadow.querySelector<HTMLElement>('.translation-surface')!};
  }

  it('wraps a UI-classified heading without ellipsis and preserves typography and text bounds', () => {
    const {renderer, surface} = render();
    expect(surface.hidden).toBe(false);
    expect(surface.dataset.renderingPolicy).toBe('title');
    expect(surface.classList.contains('compact')).toBe(false);
    expect(surface.style.width).toBe('300px');
    expect(surface.style.height).toBe('100px');
    expect(surface.style.transform).toBe('translate(10px, 20px)');
    expect(surface.style.backgroundColor).toBe('rgb(230, 240, 250)');
    expect(surface.style.color).toBe('rgb(20, 30, 40)');
    expect(shadow.querySelector('style')!.textContent).not.toContain('ellipsis');
    renderer.dispose();
  });

  it('suppresses full translation overflow then restores it when geometry fits', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900);
    const {renderer, surface} = render('READING');
    expect(surface.hidden).toBe(true);
    expect(surface.dataset.suppressionReason).toBe('translation-overflow');
    expect(Number.parseFloat(surface.style.fontSize)).toBe(16);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(0);
    renderer.reposition();
    expect(surface.hidden).toBe(false);
    expect(surface.dataset.suppressionReason).toBe('');
    renderer.dispose();
  });

  it('remeasures after original-view scrolling instead of treating hidden layout as fitting', () => {
    const {renderer, surface} = render();
    const toggle = shadow.querySelector<HTMLButtonElement>('.toggle')!;
    toggle.click();
    renderer.reposition();
    expect(surface.hidden).toBe(true);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900);
    toggle.click();
    expect(surface.hidden).toBe(true);
    expect(surface.dataset.suppressionReason).toBe('translation-overflow');
    renderer.dispose();
  });
});

describe('essential text regression', () => {
  it('accepts visible glyph ink outside a heading line-height inside safe parent space', () => {
    vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(rect(10, 38, 300, 20));
    const measurement = measureSurface(source);
    expect(measurement).toHaveProperty('box');
    if ('box' in measurement) expect(measurement.box).toMatchObject({top:30.5, bottom:78.5});
  });

  it('ignores an empty overlapping container but protects its actual text', () => {
    const neighbour = document.createElement('div'); source.after(neighbour);
    vi.spyOn(neighbour, 'getBoundingClientRect').mockReturnValue(rect(10,20,300,100));
    expect(measureSurface(source)).toHaveProperty('box');
    neighbour.textContent = 'Other menu';
    expect(measureSurface(source)).toEqual({reason:'overlapping-neighbour'});
  });

  it('falls back to ink bounds when optional content space would cover a neighbour', () => {
    const neighbour = document.createElement('span'); neighbour.textContent = 'USD 129'; source.after(neighbour);
    vi.spyOn(neighbour, 'getBoundingClientRect').mockReturnValue(rect(250,40,30,20));
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      let node: Node;
      return {selectNodeContents(value: Node) {node=value;}, getClientRects: () =>
        node!.parentElement === neighbour ? [rect(250,40,30,20)] : [rect()] } as unknown as Range;
    });
    expect(measureSurface(source)).toMatchObject({box:{left:20.25,right:220.75}});
  });
});

describe('short label visibility and hidden reasons', () => {
  it('renders a readable label narrower than 48px and counts it as displayed', () => {
    source.outerHTML = '<a id="short" style="font-size:14px;line-height:20px">Write</a>';
    source = document.querySelector('#short')!;
    vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(rect(20,30,40,20));
    vi.spyOn(document, 'createRange').mockReturnValue({selectNodeContents() {}, getClientRects: () => [rect(20,30,36,16)]} as unknown as Range);
    const renderer = new OverlayRenderer(() => {});
    renderer.reconcile([{id:'short',sourceKey:'s',element:source,text:'Write',language:'en',semanticClass:'UI',viewportBand:'VIEWPORT',translationPriority:1,rect:source.getBoundingClientRect()}],
      new Map([['short',{regionId:'short',requestKey:'q',translatedText:'글쓰기',provider:'test'}]]));
    expect(renderer.getSurfaceDiagnostics()[0]).toMatchObject({hidden:false,suppressionReason:''});
    expect(renderer.getDisplayedRegionIds().has('short')).toBe(true);
    vi.spyOn(source, 'getBoundingClientRect').mockReturnValue(rect(20,innerHeight+30,40,20));
    renderer.reposition();
    expect(renderer.getSurfaceDiagnostics()[0]).toMatchObject({hidden:true,suppressionReason:'offscreen-or-empty'});
    expect(renderer.getDisplayedRegionIds().size).toBe(0);
    renderer.dispose();
  });
});
