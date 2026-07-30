# Jelly

An HTML5 clone of Jelly no Puzzle, built with plain HTML, CSS, and
JavaScript.

## Play

After GitHub Pages is enabled, the game is available at:

<https://ivv101.github.io/jelly_dev/>

## Development

The project has no runtime or package dependencies. Run the complete check
suite with Node.js 18 or newer:

```sh
npm run check
```

Regenerate the single-file version after changing `index.html` or `jelly.js`:

```sh
npm run build:standalone
```

## GitHub Pages deployment

The workflow in `.github/workflows/deploy-pages.yml` checks the project and
publishes the static site whenever `main` is updated. It can also be started
manually from the repository's Actions tab.

For the first deployment, open **Settings → Pages** in the GitHub repository
and set **Source** to **GitHub Actions**. Then run the workflow or push to
`main`.
