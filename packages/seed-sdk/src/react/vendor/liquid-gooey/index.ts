/*! liquid-gooey — MIT License

Copyright (c) 2026 Jakub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 */
import { GooeyRoot } from './Gooey'
import { LiquidItem } from './LiquidItem'

/** The liquid group: renders the merged silhouette (goo + real shadows) behind
 *  your crisp content. Put `Liquid.Item`s inside. */
export const Liquid = Object.assign(GooeyRoot, { Item: LiquidItem })

export type { GooeyProps as LiquidProps } from './Gooey'
export type {
  BendTuning,
  LiquidEffect,
  LiquidItemProps,
  MorphTuning,
  MoveTuning,
} from './LiquidItem'
export { IMAGE_MELT_DEFAULTS } from './imageMelt'
export type { ImageMeltOptions } from './imageMelt'

// ---- advanced escape hatch (raw engine options + defaults) ----
export type { DissolveOptions } from './GooeyItem'
export { EVOLVE_DEFAULTS, MOVE_DEFAULTS } from './observer'
export type { EvolveOptions, MoveOptions } from './observer'
export { easingFunction, presets } from './spring'
export type { SpringConfig, Transition, TransitionPreset } from './spring'
export type { CornerRadii } from './geometry'
