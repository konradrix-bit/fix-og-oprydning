# Phantom Range

Offline combat visualizer with a separate settings menu and a player overlay. Dummy players walk a local range. The page does not read memory, move the system cursor, inject code, or connect to a game.

## Run

```bash
npm test
npm start
```

Open `http://127.0.0.1:4173`.

## Controls

- **Insert** hides and shows the menu. Holding the key does not repeat the toggle.
- The overlay keeps drawing while the menu is hidden. ESP has its own switch, and **F2** flips it without opening the menu.
- **WASD** moves. Right mouse looks. Left click fires a simulated shot.
- **Q** and **T** are the default hold keys for the aimbot and triggerbot simulations. Both can be rebound from the menu.

Changing a slider updates the running simulation immediately. Closing the menu leaves those values in place.
