import importlib.util
import pathlib
import unittest
spec = importlib.util.spec_from_file_location('setup', pathlib.Path(__file__).parents[1] / 'scripts/stage-zola-telegram.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
def update(uid=123, text='pair', date=100, chat_type='private', bot=False, chat_id=None):
    return {'message': {'text': text, 'date': date, 'from': {'id': uid, 'is_bot': bot},
                        'chat': {'id': uid if chat_id is None else chat_id, 'type': chat_type}}}
class Pairing(unittest.TestCase):
    def test_private_fresh_matching_owner(self):
        self.assertEqual(setup.pairing_owner([update()], 'pair', 100), 123)
    def test_reject_other_chats_stale_wrong_codes_and_bots(self):
        for value in [update(text='wrong'), update(date=99), update(chat_type='group'),
                      update(bot=True), update(chat_id=456), update(uid='123')]:
            with self.assertRaises(setup.SetupError):
                setup.pairing_owner([value], 'pair', 100)
    def test_ambiguous_owners_fail(self):
        with self.assertRaises(setup.SetupError):
            setup.pairing_owner([update(), update(uid=456)], 'pair', 100)
    def test_no_mutating_api_methods(self):
        with self.assertRaises(setup.SetupError):
            setup.api('unused', 'setWebhook')
if __name__ == '__main__':
    unittest.main()
