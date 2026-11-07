
package smartport_m1m.m1.validation;

public final class ImoValidator {

    private ImoValidator() {
    }

    public static boolean isValid(String imo) {

        if (imo == null || !imo.matches("[1-9][0-9]{6}")) {
            return false;
        }

        int sum = 0;

        for (int i = 0; i < 6; i++) {
            int digit = imo.charAt(i) - '0';
            int weight = 7 - i;
            sum += digit * weight;
        }

        int checkDigit = sum % 10;
        int lastDigit = imo.charAt(6) - '0';

        return checkDigit == lastDigit;
    }
}
