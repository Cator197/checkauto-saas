# Sprint 6 — Base de Auth Helpers

## Padrão de token
- Nome do item no `localStorage`: `checkauto_access`.

## Arquivos criados
- `core/static/painel/js/auth.js`
- `core/static/painel/js/api.js`

## Como usar nos próximos PRs
Inclua os helpers nas páginas que precisam proteger o acesso antes de carregar dados:

```html
<script src="{% static 'painel/js/auth.js' %}"></script>
<script src="{% static 'painel/js/api.js' %}"></script>
<script>
    (async () => {
        await verificarAutenticacao();
        // continue carregando a página / chamando APIs
    })();
</script>
```
