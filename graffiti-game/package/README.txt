ALLEY KINGS
An urban graffiti game. One back alley, one night, one bag of cans.


-------------------------------------------------------------------
HOW TO START IT
-------------------------------------------------------------------

WINDOWS
  Double-click  PLAY-WINDOWS.bat

macOS
  Double-click  PLAY-mac-linux.command

  The first time, macOS may refuse because the file came from the
  internet. If that happens: right-click the file, choose Open, then
  click Open in the dialog. You only have to do this once.

LINUX
  Double-click  PLAY-mac-linux.command  (or run it from a terminal)

A terminal window opens and your browser follows a second later.
Leave the terminal window open while you play - it is the little web
server the game runs on. Close it, or press Ctrl+C in it, when you
are finished.

Nothing is installed on your machine. Nothing runs after you close
that window. To uninstall, delete this folder.


-------------------------------------------------------------------
IF IT DOES NOT START
-------------------------------------------------------------------

The launcher uses Node.js or Python if you already have either, and
falls back to launching Chrome or Edge directly if you do not.

If it cannot find any of those, install Node.js from nodejs.org and
run the launcher again.

Failing that, open alley-kings-single-file.html in this folder. It
needs nothing at all - just double-click it. The only difference is
that loose bins and bottles stay put instead of scattering when you
walk through them.


-------------------------------------------------------------------
HOW TO PLAY
-------------------------------------------------------------------

Click NEW NIGHT, then click the screen to lock the mouse.

  W A S D          Walk
  Shift            Run
  Ctrl             Crouch - quieter, and lets you paint low
  Space            Jump
  E                Pick things up / HOLD to finish a piece
  P                Start painting (walk up to a wall first)
  F                Raise the camera
  G                Your photos
  Esc              Pause, and the full control list

While painting:

  Hold left mouse  Spray
  1-9 or wheel     Pick a colour
  Q                Change cap: skinny / standard / fat
  R                Shake the can - pressure drops as you spray
  Z                Undo the last stroke
  B                Lay a base coat over the whole wall
  T                Stencils. [ and ] change, comma and full stop
                   rotate, wheel resizes


-------------------------------------------------------------------
THE SHORT VERSION OF WHAT TO DO
-------------------------------------------------------------------

Walk down the alley. Find a wall. Press P, hold the left mouse
button and paint something. Hold E to step back and have it scored.

Then press F, frame it up nicely, and click to photograph it. Press
G and post the photo. That is where most of your fame comes from -
a piece nobody sees is worth very little.

Watch the top right. The dots are your wanted level. An eye means
somebody is looking at you and starting to wonder. If they call it
in, police arrive from the ends of the district and sweep towards
where you were last seen - break their line of sight and stay out of
it. Under the overpass and the dead end are the good hiding places.

The most exposed walls pay the best and are the most likely to get
you nicked. That is the whole game, really.

Your progress saves by itself, in your browser.


-------------------------------------------------------------------
NOTES
-------------------------------------------------------------------

It is set at night and it is meant to be dim. If it looks dark, that
is the intended mood rather than a broken build.

Needs a reasonably current browser - Chrome, Edge, Firefox or
Safari - and a graphics card that supports WebGL 2, which is
anything from roughly the last decade.

Source code and the full write-up are in the graffiti-game folder of
the repository this came from.
