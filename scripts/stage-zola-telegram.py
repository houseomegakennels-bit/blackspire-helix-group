#!/usr/bin/env python3
"""Stage Telegram credentials and prove a private owner chat. Never activates transport."""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import time
import urllib.error
import urllib.request

ROOT = Path('/var/lib/blackspire-operator/zola-telegram')
PENDING = ROOT / 'pending.json'
PAIRED = ROOT / 'paired.json'

class SetupError(Exception):
    pass

def api(token, method, data=None):
    if method not in {'getMe', 'getWebhookInfo', 'getUpdates'}:
        raise SetupError('Setup only permits read-only Telegram API methods.')
    request = urllib.request.Request(
        'https://api.telegram.org/bot' + token + '/' + method,
        data=json.dumps(data or {}).encode(),
        headers={'Content-Type': 'application/json'},
        method='POST')
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.loads(response.read(1024 * 1024))
    except Exception:
        raise SetupError('Telegram verification failed. Check the token and connection; no service was activated.') from None
    if result.get('ok') is not True:
        raise SetupError('Telegram rejected verification; no service was activated.')
    return result.get('result')

def protected_root():
    if os.geteuid() != 0 or not sys.stdin.isatty():
        raise SetupError('Run as root in an interactive Termius terminal.')
    ROOT.mkdir(mode=0o700, exist_ok=True)
    s = ROOT.lstat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o077:
        raise SetupError('Setup directory must be root-owned with mode 0700.')

def write_new(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        raise SetupError('Unable to finish credential staging; inspect protected staging state before retrying.') from None

def read_protected(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream:
        s = os.fstat(stream.fileno())
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o077:
            raise SetupError('Unsafe credential staging file.')
        return json.load(stream)

def pairing_owner(updates, phrase, since):
    matches = set()
    for update in updates:
        msg = update.get('message') or {}
        sender = msg.get('from') or {}
        chat = msg.get('chat') or {}
        uid = sender.get('id')
        if (msg.get('text') == phrase and msg.get('date', 0) >= since
                and chat.get('type') == 'private' and sender.get('is_bot') is False
                and type(uid) is int and uid > 0 and chat.get('id') == uid):
            matches.add(uid)
    if len(matches) != 1:
        raise SetupError('One matching private pairing message is required. Nothing was activated.')
    return next(iter(matches))

def stage():
    if PENDING.exists() or PAIRED.exists():
        raise SetupError('Staging already exists. Use --pair to finish pending setup; existing pairing is never overwritten.')
    token = getpass.getpass('Paste the BotFather token (hidden): ').strip()
    if not re.fullmatch(r'[0-9]{5,20}:[A-Za-z0-9_-]{20,100}', token):
        raise SetupError('Token format is invalid.')
    bot = api(token, 'getMe')
    if not bot or bot.get('is_bot') is not True or not re.fullmatch(r'[A-Za-z0-9_]+', bot.get('username', '')):
        raise SetupError('Telegram did not identify a bot.')
    if api(token, 'getWebhookInfo').get('url'):
        raise SetupError('This bot already has a webhook. Setup will not take over an existing integration.')
    print('Verified bot: @' + bot['username'])
    if input('Use this bot for Zola? Type yes: ').strip().lower() != 'yes':
        raise SetupError('Cancelled without saving credentials.')
    write_new(PENDING, {'version': 1, 'token': token, 'botId': bot['id'], 'username': bot['username']})
    print('Token staged privately. It has not been activated.')

def pair():
    if PAIRED.exists():
        raise SetupError('Pairing already exists. No configuration was changed.')
    pending = read_protected(PENDING)
    if api(pending['token'], 'getWebhookInfo').get('url'):
        raise SetupError('This bot has an active webhook; refusing to take it over.')
    since = int(time.time())
    phrase = '/start zola_' + secrets.token_hex(16)
    print('\nOpen https://t.me/' + pending['username'])
    print('Send this exact message from YOUR private Telegram account:\n\n' + phrase + '\n')
    input('After sending it, return here and press Enter: ')
    if time.time() - since > 600:
        raise SetupError('Pairing expired. Run --pair again for a new code.')
    updates = api(pending['token'], 'getUpdates', {'timeout': 0, 'limit': 100})
    uid = pairing_owner(updates, phrase, since)
    write_new(PAIRED, {**pending, 'allowedUserId': uid, 'privateChatId': uid, 'pairedAt': int(time.time()),
                       'webhookSecret': secrets.token_urlsafe(32), 'status': 'STAGED_NOT_ACTIVE'})
    print('Private account paired. Tell Codex: Telegram staged.')
    print('No polling, webhook, service restart, or outbound message was performed.')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pair', action='store_true', help='Finish previously staged credentials')
    args = parser.parse_args()
    try:
        protected_root()
        if not args.pair:
            stage()
        pair()
    except (SetupError, FileNotFoundError, FileExistsError, KeyboardInterrupt, EOFError) as error:
        print('Setup stopped: ' + (str(error) if isinstance(error, SetupError) else 'No activation performed; rerun with --pair if credentials were staged.'), file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
