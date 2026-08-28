## Code Formatter

This project uses [Prettier](https://prettier.io/) to format its code.

Please, use the library along with the rules added to this project, following
the code format pattern.

### Configuration Guide Examples:

<details>
<summary>VSCode</summary>

Install the official [extension](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode).
Then, add this to your settings:

```
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
}
```

If you pConfig, add the following configuration to format your conde on save:

```
{
  "editor.formatOnSave": true,
}
```

For more options see their
[repository](https://github.com/prettier/prettier-vscode).

</details>

<details>
<summary>Jetbrains</summary>

Follow the official [documentation](https://www.jetbrains.com/help/webstorm/prettier.html),
selecting the option:

```
Tools -> Actions on Save -> Run Prettier.

```

Also, certifies that the IDE is using the Prettier rules defined by this project.

</details>

<details>
<summary>Emacs</summary>

Install prettier [package](https://github.com/jscheid/prettier.el) through
[MELPA](https://melpa.org/#/prettier). Then add this hook, to your **.
emacs** file, to format your changes on save:

```
(add-hook 'after-init-hook #'global-prettier-mode)

```

</details>

For more IDE configuration guides, see prettier official
[documentation](https://prettier.io/docs/en/editors.html) and install the proper plugin for your IDE.

### Troubleshooting

If you had any trouble configuring prettier - after you make your changes -
run the following command to apply the code formatter:

```bash
npm run prettier
```

**Or**

Feel free to
[open an Issue](https://github.com/senecajs/seneca-Config/issues).
