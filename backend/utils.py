"""
Utilitaires transverses du backend Novlearn.
"""
import random
import string


def generate_unique_code(length: int = 8) -> str:
    """
    Code d'invitation lisible : caracteres ambigus (I, O, 0, 1) exclus.
    """
    chars = string.ascii_uppercase + string.digits
    chars = chars.replace('I', '').replace('O', '').replace('0', '').replace('1', '')
    return ''.join(random.choice(chars) for _ in range(length))
