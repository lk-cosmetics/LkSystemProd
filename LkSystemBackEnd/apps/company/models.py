"""
LkSystem Company App - Models
Company entity representing the parent organization in the ERP.
"""

from django.db import models
from django.core.validators import RegexValidator, MinLengthValidator


class TunisiaCities(models.TextChoices):
    """All 24 Governorates (Wilayas) of Tunisia"""
    TUNIS = 'Tunis', 'Tunis'
    ARIANA = 'Ariana', 'Ariana'
    BEN_AROUS = 'Ben Arous', 'Ben Arous'
    MANOUBA = 'Manouba', 'Manouba'
    NABEUL = 'Nabeul', 'Nabeul'
    ZAGHOUAN = 'Zaghouan', 'Zaghouan'
    BIZERTE = 'Bizerte', 'Bizerte'
    BEJA = 'Béja', 'Béja'
    JENDOUBA = 'Jendouba', 'Jendouba'
    KEF = 'Kef', 'Kef'
    SILIANA = 'Siliana', 'Siliana'
    SOUSSE = 'Sousse', 'Sousse'
    MONASTIR = 'Monastir', 'Monastir'
    MAHDIA = 'Mahdia', 'Mahdia'
    SFAX = 'Sfax', 'Sfax'
    KAIROUAN = 'Kairouan', 'Kairouan'
    KASSERINE = 'Kasserine', 'Kasserine'
    SIDI_BOUZID = 'Sidi Bouzid', 'Sidi Bouzid'
    GABES = 'Gabès', 'Gabès'
    MEDENINE = 'Medenine', 'Medenine'
    TATAOUINE = 'Tataouine', 'Tataouine'
    GAFSA = 'Gafsa', 'Gafsa'
    TOZEUR = 'Tozeur', 'Tozeur'
    KEBILI = 'Kebili', 'Kebili'


class Company(models.Model):
    """
    Parent entity representing a company in the ERP system.
    The abbreviation is auto-generated from name if not provided.
    """
    
    # Basic Information - Only 'name' is required!
    name = models.CharField(
        max_length=255,
        verbose_name='Company Name',
        help_text='Commercial name of the company'
    )
    legal_name = models.CharField(
        max_length=255,
        blank=True,
        default='',
        verbose_name='Legal Name',
        help_text='Official registered legal name (auto-filled from name if empty)'
    )
    abbreviation = models.CharField(
        max_length=5,
        unique=True,
        blank=True,
        verbose_name='Abbreviation',
        help_text='Auto-generated from company name (max 5 chars, uppercase)'
    )
    
    # Branding
    logo = models.ImageField(
        upload_to='companies/logos/',
        null=True,
        blank=True,
        verbose_name='Company Logo'
    )
    
    # Legal & Tax Information
    matricule_fiscale = models.CharField(
        max_length=50,
        blank=True,
        default='',
        verbose_name='Matricule Fiscale',
        help_text='Tax identification number'
    )
    registre_commerce = models.CharField(
        max_length=50,
        blank=True,
        default='',
        verbose_name='Registre de Commerce',
        help_text='Commercial register number'
    )
    activity_code = models.CharField(
        max_length=20,
        blank=True,
        default='',
        verbose_name='Activity Code',
        help_text='NAF/APE activity classification code'
    )
    
    # Banking Information
    bank_name = models.CharField(
        max_length=100,
        blank=True,
        default='',
        verbose_name='Bank Name'
    )
    rib = models.CharField(
        max_length=20,
        blank=True,
        default='',
        verbose_name='RIB',
        help_text='20-digit bank account identifier',
        validators=[
            RegexValidator(
                regex=r'^\d{0,20}$',
                message='RIB must contain up to 20 digits only'
            )
        ]
    )
    
    # Contact Information
    address = models.TextField(
        blank=True,
        default='',
        verbose_name='Address'
    )
    city = models.CharField(
        max_length=100,
        choices=TunisiaCities.choices,
        default=TunisiaCities.TUNIS,
        verbose_name='City',
        help_text='Select a city from Tunisia governorates'
    )
    phone = models.CharField(
        max_length=20,
        blank=True,
        default='',
        verbose_name='Phone Number'
    )
    email = models.EmailField(
        blank=True,
        default='',
        verbose_name='Email Address'
    )
    
    # Status
    is_active = models.BooleanField(
        default=True,
        verbose_name='Active',
        help_text='Designates whether this company is active'
    )
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        app_label = 'company'
        db_table = 'company'
        verbose_name = 'Company'
        verbose_name_plural = 'Companies'
        ordering = ['name']
    
    def __str__(self):
        return f"{self.name} ({self.abbreviation})"
    
    def save(self, *args, **kwargs):
        # Auto-fill legal_name from name if not provided
        if not self.legal_name:
            self.legal_name = self.name
        
        # Auto-generate abbreviation from name if not provided
        if not self.abbreviation:
            self.abbreviation = self._generate_abbreviation()
        
        # Ensure abbreviation is always uppercase and max 5 chars
        self.abbreviation = self.abbreviation.upper()[:5]
        
        # Clean phone number (remove spaces)
        if self.phone:
            self.phone = self.phone.replace(' ', '')
        
        super().save(*args, **kwargs)
    
    def _generate_abbreviation(self):
        """
        Auto-generate a unique abbreviation from company name.
        Takes first letters of each word, or first 5 chars if single word.
        """
        import re
        
        # Get words from name
        words = self.name.split()
        
        if len(words) >= 2:
            # Take first letter of each word (up to 5)
            abbrev = ''.join(word[0] for word in words[:5]).upper()
        else:
            # Single word: take first 5 consonants or chars
            abbrev = re.sub(r'[aeiouAEIOU\s]', '', self.name)[:5].upper()
            if len(abbrev) < 2:
                abbrev = self.name[:5].upper()
        
        # Ensure uniqueness by adding numbers if needed
        base_abbrev = abbrev[:4]  # Leave room for number
        counter = 1
        while Company.objects.filter(abbreviation=abbrev).exclude(pk=self.pk).exists():
            abbrev = f"{base_abbrev}{counter}"[:5]
            counter += 1
        
        return abbrev
