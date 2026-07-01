#!/bin/bash
# Первичная выдача SSL-сертификатов.
#
# nginx.conf уже ссылается на /etc/letsencrypt/live/$DOMAIN/{fullchain,privkey}.pem
# для каждого домена — но при первом запуске их ещё не существует, и nginx
# не стартует на отсутствующие файлы (классическая проблема курицы и яйца).
# Решение (стандартный приём certbot+nginx): сначала кладём временный
# self-signed сертификат на каждый домен, чтобы nginx смог подняться и начать
# отдавать ACME challenge на 80-м порту, потом запрашиваем настоящий через
# webroot, потом перезагружаем nginx с настоящим.
set -e

DOMAINS="api.yourdomain.com app.yourdomain.com cdn.yourdomain.com"
EMAIL="admin@yourdomain.com"

echo "Домены: $DOMAINS"
echo "Если они не совпадают с infra/nginx/conf.d/main.conf — поправьте оба файла и не запускайте."
read -p "Продолжить? (y/N) " -n 1 -r
echo
[[ $REPLY =~ ^[Yy]$ ]] || exit 1

for DOMAIN in $DOMAINS; do
  echo "Временный self-signed сертификат для $DOMAIN..."
  docker compose -f docker-compose.prod.yml run --rm --entrypoint sh certbot -c "
    mkdir -p /etc/letsencrypt/live/$DOMAIN &&
    openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
      -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
      -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
      -subj '/CN=$DOMAIN'
  "
done

echo "Запускаю nginx с временными сертификатами..."
docker compose -f docker-compose.prod.yml up -d nginx

for DOMAIN in $DOMAINS; do
  echo "Удаляю временный сертификат и запрашиваю настоящий для $DOMAIN..."
  docker compose -f docker-compose.prod.yml run --rm --entrypoint sh certbot -c "rm -rf /etc/letsencrypt/live/$DOMAIN /etc/letsencrypt/archive/$DOMAIN /etc/letsencrypt/renewal/$DOMAIN.conf"
  docker compose -f docker-compose.prod.yml run --rm certbot \
    certonly --webroot \
    --webroot-path=/var/www/certbot \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN"
done

echo "Перезагружаю nginx с настоящими сертификатами..."
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload

echo "SSL сертификаты получены."
