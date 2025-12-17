# Hotfix estático (Painel)

Os erros 500 no painel estavam relacionados ao `ManifestStaticFilesStorage` reclamando de caminhos inexistentes para novos arquivos JS. Sempre que novos arquivos estáticos forem adicionados ou os templates receberem novas referências via `{% static %}`, é obrigatório executar o collectstatic no deploy:

```bash
python manage.py collectstatic --noinput
```

Sem essa etapa, o manifest continuará apontando para arquivos antigos e o WhiteNoise retornará 500 ao tentar resolver as URLs de estáticos.
