"""
LkSystem Users App - Profile Model
Extended HR data for users including identity, bio, and education.
"""

from django.db import models
from django.core.validators import RegexValidator


class Profile(models.Model):
    """
    Extended user profile for HR data.
    Contains identity documents, personal info, and education details.
    All fields are optional - profile completeness is tracked.
    """
    
    class Gender(models.TextChoices):
        MALE = 'M', 'Male'
        FEMALE = 'F', 'Female'
        OTHER = 'O', 'Other'
    
    class EducationLevel(models.TextChoices):
        NONE = 'NONE', 'No Formal Education'
        PRIMARY = 'PRIMARY', 'Primary School'
        SECONDARY = 'SECONDARY', 'Secondary School'
        BAC = 'BAC', 'Baccalaureate'
        LICENSE = 'LICENSE', 'License (Bachelor)'
        MASTER = 'MASTER', 'Master\'s Degree'
        DOCTORATE = 'DOCTORATE', 'Doctorate (PhD)'
        OTHER = 'OTHER', 'Other'
    
    # One-to-One relationship with User
    user = models.OneToOneField(
        'users.User',
        on_delete=models.CASCADE,
        related_name='profile',
        verbose_name='User'
    )
    
    # =========================================================================
    # IDENTITY DOCUMENTS
    # =========================================================================
    
    cin_number = models.CharField(
        max_length=20,
        unique=True,
        null=True,
        blank=True,
        verbose_name='CIN Number',
        help_text='National Identity Card number',
        validators=[
            RegexValidator(
                regex=r'^[A-Z0-9]+$',
                message='CIN must contain only uppercase letters and numbers'
            )
        ]
    )
    cin_front = models.ImageField(
        upload_to='profiles/cin/front/',
        null=True,
        blank=True,
        verbose_name='CIN Front Image'
    )
    cin_back = models.ImageField(
        upload_to='profiles/cin/back/',
        null=True,
        blank=True,
        verbose_name='CIN Back Image'
    )
    
    passport_number = models.CharField(
        max_length=20,
        null=True,
        blank=True,
        verbose_name='Passport Number'
    )
    passport_image = models.ImageField(
        upload_to='profiles/passport/',
        null=True,
        blank=True,
        verbose_name='Passport Image'
    )
    
    # =========================================================================
    # BIOGRAPHICAL DATA
    # =========================================================================
    
    birth_date = models.DateField(
        null=True,
        blank=True,
        verbose_name='Date of Birth'
    )
    gender = models.CharField(
        max_length=1,
        choices=Gender.choices,
        null=True,
        blank=True,
        verbose_name='Gender'
    )
    nationality = models.CharField(
        max_length=100,
        blank=True,
        default='',
        verbose_name='Nationality'
    )
    
    # Contact Information
    phone = models.CharField(
        max_length=20,
        blank=True,
        default='',
        verbose_name='Phone Number'
    )
    emergency_phone = models.CharField(
        max_length=20,
        blank=True,
        default='',
        verbose_name='Emergency Contact Phone'
    )
    emergency_contact_name = models.CharField(
        max_length=150,
        blank=True,
        default='',
        verbose_name='Emergency Contact Name'
    )
    
    # Address
    address = models.TextField(
        blank=True,
        default='',
        verbose_name='Address'
    )
    city = models.CharField(
        max_length=100,
        blank=True,
        default='',
        verbose_name='City'
    )
    postal_code = models.CharField(
        max_length=20,
        blank=True,
        default='',
        verbose_name='Postal Code'
    )
    
    # Avatar
    avatar = models.ImageField(
        upload_to='profiles/avatars/',
        null=True,
        blank=True,
        verbose_name='Profile Picture'
    )
    
    # =========================================================================
    # EDUCATION
    # =========================================================================
    
    education_level = models.CharField(
        max_length=20,
        choices=EducationLevel.choices,
        null=True,
        blank=True,
        verbose_name='Education Level'
    )
    diploma_title = models.CharField(
        max_length=200,
        blank=True,
        default='',
        verbose_name='Diploma/Degree Title'
    )
    diploma_file = models.FileField(
        upload_to='profiles/diplomas/',
        null=True,
        blank=True,
        verbose_name='Diploma File'
    )
    institution = models.CharField(
        max_length=200,
        blank=True,
        default='',
        verbose_name='Educational Institution'
    )
    graduation_year = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name='Graduation Year'
    )
    
    # =========================================================================
    # PROFILE COMPLETENESS TRACKING
    # =========================================================================
    
    is_complete = models.BooleanField(
        default=False,
        verbose_name='Profile Complete',
        help_text='Indicates if all required profile fields are filled'
    )
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        app_label = 'users'
        db_table = 'users_profile'
        verbose_name = 'User Profile'
        verbose_name_plural = 'User Profiles'
    
    def __str__(self):
        return f"Profile: {self.user.matricule}"
    
    def check_completeness(self):
        """
        Check if all essential profile fields are filled.
        Returns True if profile is complete, False otherwise.
        """
        required_fields = [
            self.cin_number,
            self.birth_date,
            self.gender,
            self.phone,
            self.address,
            self.city,
        ]
        return all(field for field in required_fields)
    
    def get_completion_percentage(self):
        """
        Calculate profile completion percentage.
        Returns a value between 0 and 100.
        """
        fields_to_check = [
            ('cin_number', self.cin_number),
            ('cin_front', self.cin_front),
            ('cin_back', self.cin_back),
            ('birth_date', self.birth_date),
            ('gender', self.gender),
            ('nationality', self.nationality),
            ('phone', self.phone),
            ('address', self.address),
            ('city', self.city),
            ('avatar', self.avatar),
            ('education_level', self.education_level),
        ]
        
        filled_count = sum(1 for _, value in fields_to_check if value)
        total_count = len(fields_to_check)
        
        return int((filled_count / total_count) * 100) if total_count > 0 else 0
    
    def save(self, *args, **kwargs):
        """Update is_complete flag before saving."""
        self.is_complete = self.check_completeness()
        super().save(*args, **kwargs)
