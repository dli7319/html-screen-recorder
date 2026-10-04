import { beforeEach, describe, expect, it } from 'vitest';
import { Cropper } from './cropper';

/** jsdom does no layout, so paint the geometry the code reads by hand. */
function setBox(
  el: HTMLElement,
  box: { left: number; top: number; width: number; height: number }
) {
  el.getBoundingClientRect = () =>
    ({
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      right: box.left + box.width,
      bottom: box.top + box.height,
      x: box.left,
      y: box.top,
      toJSON: () => ({}),
    }) as DOMRect;

  for (const [prop, value] of [
    ['offsetLeft', box.left],
    ['offsetTop', box.top],
    ['offsetWidth', box.width],
    ['offsetHeight', box.height],
  ] as const) {
    Object.defineProperty(el, prop, { value, configurable: true });
  }
}

function setup() {
  document.body.innerHTML = `
    <div id="videoContainer">
      <video id="videoPreview"></video>
      <div id="cropBox">
        <div class="resize-handle top left"></div>
        <div class="resize-handle top right"></div>
        <div class="resize-handle bottom left"></div>
        <div class="resize-handle bottom right"></div>
      </div>
      <div id="cropTargetElement"></div>
    </div>
  `;

  const cropBox = document.getElementById('cropBox') as HTMLDivElement;
  const cropTarget = document.getElementById(
    'cropTargetElement'
  ) as HTMLDivElement;
  const videoContainer = document.getElementById(
    'videoContainer'
  ) as HTMLDivElement;
  const videoPreview = document.getElementById(
    'videoPreview'
  ) as HTMLVideoElement;

  // A 400x300 preview with the crop box inset at 40,30 sized 200x150.
  setBox(videoContainer, { left: 0, top: 0, width: 400, height: 300 });
  setBox(cropBox, { left: 40, top: 30, width: 200, height: 150 });

  const cropper = new Cropper(
    cropBox,
    cropTarget,
    videoContainer,
    videoPreview
  );
  return { cropper, cropBox, cropTarget, videoContainer };
}

const mouse = (type: string, x: number, y: number, target: EventTarget) =>
  target.dispatchEvent(
    new MouseEvent(type, { clientX: x, clientY: y, bubbles: true })
  );

const style = (el: HTMLElement) => ({
  left: el.style.left,
  top: el.style.top,
  width: el.style.width,
  height: el.style.height,
});

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Cropper.show', () => {
  it('centres a default box on both the overlay and its crop target', () => {
    const { cropper, cropBox, cropTarget } = setup();
    cropper.show();

    const expected = {
      left: '10%',
      top: '10%',
      width: '80%',
      height: '80%',
    };
    expect(style(cropBox)).toEqual(expected);
    expect(style(cropTarget)).toEqual(expected);
  });
});

describe('Cropper dragging', () => {
  it('moves the crop box and its target by the same delta', () => {
    const { cropBox, cropTarget } = setup();

    mouse('mousedown', 100, 100, cropBox);
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 130, clientY: 125 })
    );

    expect(style(cropBox)).toEqual({
      left: '70px',
      top: '55px',
      width: '',
      height: '',
    });
    expect(cropTarget.style.left).toBe('70px');
    expect(cropTarget.style.top).toBe('55px');
  });

  it('clamps to the bottom-right edge of the preview', () => {
    const { cropBox } = setup();

    mouse('mousedown', 100, 100, cropBox);
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 400, clientY: 400 })
    );

    // never further right than 400 - 200, nor down than 300 - 150
    expect(cropBox.style.left).toBe('200px');
    expect(cropBox.style.top).toBe('150px');
  });

  it('clamps to the top-left edge of the preview', () => {
    const { cropBox } = setup();

    mouse('mousedown', 100, 100, cropBox);
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: -500, clientY: -500 })
    );

    expect(cropBox.style.left).toBe('0px');
    expect(cropBox.style.top).toBe('0px');
  });

  it('ignores the mouse once released', () => {
    const { cropBox } = setup();

    mouse('mousedown', 100, 100, cropBox);
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 120, clientY: 100 })
    );
    window.dispatchEvent(new MouseEvent('mouseup', {}));
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 300, clientY: 300 })
    );

    expect(cropBox.style.left).toBe('60px');
    expect(cropBox.style.top).toBe('30px');
  });

  it('keeps its size while being dragged', () => {
    const { cropBox } = setup();

    mouse('mousedown', 100, 100, cropBox);
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 150, clientY: 160 })
    );

    expect(cropBox.style.width).toBe('');
    expect(cropBox.style.height).toBe('');
  });
});

describe('Cropper resizing', () => {
  it('grows from the right/bottom handle without moving the origin', () => {
    const { cropBox, cropTarget } = setup();
    const handle = cropBox.querySelector('.bottom.right') as HTMLElement;

    mouse('mousedown', 240, 180, handle);
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 260, clientY: 200 })
    );

    expect(style(cropBox)).toEqual({
      left: '40px',
      top: '30px',
      width: '220px',
      height: '170px',
    });
    expect(style(cropTarget)).toEqual(style(cropBox));
  });

  it('grows from the left/top handle by moving the origin', () => {
    const { cropBox } = setup();
    const handle = cropBox.querySelector('.top.left') as HTMLElement;

    mouse('mousedown', 40, 30, handle);
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 20, clientY: 10 })
    );

    // origin moves left/up by the drag, size grows to compensate
    expect(style(cropBox)).toEqual({
      left: '20px',
      top: '10px',
      width: '220px',
      height: '170px',
    });
  });

  it('shrinks from the left/top handle until it hits the minimum', () => {
    const { cropBox } = setup();
    const handle = cropBox.querySelector('.top.left') as HTMLElement;

    mouse('mousedown', 40, 30, handle);
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 300, clientY: 300 })
    );

    expect(cropBox.style.width).toBe('20px');
    expect(cropBox.style.height).toBe('20px');
  });

  it('holds the minimum size regardless of handle', () => {
    const { cropBox } = setup();
    const handle = cropBox.querySelector('.bottom.right') as HTMLElement;

    mouse('mousedown', 240, 180, handle);
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: -2000, clientY: -2000 })
    );

    expect(cropBox.style.width).toBe('20px');
    expect(cropBox.style.height).toBe('20px');
  });

  it('cannot be dragged past the right edge of the preview', () => {
    const { cropBox } = setup();
    const handle = cropBox.querySelector('.bottom.right') as HTMLElement;

    mouse('mousedown', 240, 180, handle);
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 2000, clientY: 100 })
    );

    expect(cropBox.style.width).toBe('360px'); // 400 container - 40 left
    expect(cropBox.style.left).toBe('40px');
  });

  it('cannot be dragged past the bottom edge of the preview', () => {
    const { cropBox } = setup();
    const handle = cropBox.querySelector('.bottom.right') as HTMLElement;

    mouse('mousedown', 240, 180, handle);
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 100, clientY: 2000 })
    );

    expect(cropBox.style.height).toBe('270px'); // 300 container - 30 top
    expect(cropBox.style.top).toBe('30px');
  });

  it('pulls the origin in when the left handle crosses the edge', () => {
    const { cropBox } = setup();
    const handle = cropBox.querySelector('.top.left') as HTMLElement;

    mouse('mousedown', 40, 30, handle);
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: -500, clientY: -500 })
    );

    expect(cropBox.style.left).toBe('0px');
    expect(cropBox.style.top).toBe('0px');
    expect(cropBox.style.width).toBe('240px');
    expect(cropBox.style.height).toBe('180px');
  });

  it('stops following the mouse once released', () => {
    const { cropBox } = setup();
    const handle = cropBox.querySelector('.bottom.right') as HTMLElement;

    mouse('mousedown', 240, 180, handle);
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 250, clientY: 190 })
    );
    window.dispatchEvent(new MouseEvent('mouseup', {}));
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 2000, clientY: 2000 })
    );

    expect(cropBox.style.width).toBe('210px');
    expect(cropBox.style.height).toBe('160px');
  });

  it('treats a mousedown on the box body as a drag, not a resize', () => {
    const { cropBox } = setup();

    mouse('mousedown', 100, 100, cropBox);
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 110, clientY: 110 })
    );

    expect(style(cropBox)).toEqual({
      left: '50px',
      top: '40px',
      width: '',
      height: '',
    });
  });
});
