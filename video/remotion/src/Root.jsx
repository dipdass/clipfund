import React from "react";
import { Composition } from "remotion";
import { Main, Vertical } from "./Video.jsx";
import TL from "./timeline.json";
const frames = Math.ceil(TL.total * 30);
export const Root = () => (<>
  <Composition id="Main" component={Main} width={1920} height={1080} fps={30} durationInFrames={frames} defaultProps={{ captions: true }} />
  <Composition id="Vertical" component={Vertical} width={1080} height={1920} fps={30} durationInFrames={frames} defaultProps={{}} />
</>);
