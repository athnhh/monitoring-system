<?php
/**
 * PHPMailer Email Sender
 * Reads JSON from stdin, sends email via PHPMailer, outputs JSON result.
 */

require_once __DIR__ . '/phpmailer/Exception.php';
require_once __DIR__ . '/phpmailer/PHPMailer.php';
require_once __DIR__ . '/phpmailer/SMTP.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

$input = json_decode(file_get_contents('php://stdin'), true);
if (!$input) {
    echo json_encode(['success' => false, 'error' => 'Invalid input']);
    exit(1);
}

$action = $input['action'] ?? 'send';
$smtp  = $input['smtp'] ?? [];

// ── Test SMTP Connection ──
if ($action === 'test') {
    try {
        $mail = new PHPMailer(true);
        $mail->isSMTP();
        $mail->Host       = $smtp['host'] ?? '';
        $mail->Port       = (int)($smtp['port'] ?? 587);
        $mail->SMTPAuth   = true;
        $mail->Username   = $smtp['user'] ?? '';
        $mail->Password   = $smtp['pass'] ?? '';
        $mail->SMTPSecure = $mail->Port === 465 ? PHPMailer::ENCRYPTION_SMTPS : PHPMailer::ENCRYPTION_STARTTLS;
        $mail->SMTPOptions = ['ssl' => ['verify_peer' => false, 'verify_peer_name' => false, 'allow_self_signed' => true]];
        $mail->setFrom($smtp['user'] ?? 'test@example.com');
        $mail->addAddress($smtp['user'] ?? 'test@example.com');
        $mail->Subject = 'SMTP Test';
        $mail->Body    = 'Connection verified successfully.';
        
        if ($mail->smtpConnect()) {
            $mail->smtpClose();
            echo json_encode(['success' => true, 'message' => 'SMTP connection verified']);
        } else {
            echo json_encode(['success' => false, 'error' => 'Could not connect to SMTP server']);
        }
    } catch (Exception $e) {
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
    exit;
}

// ── Send Email ──
try {
    $mail = new PHPMailer(true);
    $mail->isSMTP();
    $mail->Host       = $smtp['host'] ?? '';
    $mail->Port       = (int)($smtp['port'] ?? 587);
    $mail->SMTPAuth   = true;
    $mail->Username   = $smtp['user'] ?? '';
    $mail->Password   = $smtp['pass'] ?? '';
    $mail->SMTPSecure = $mail->Port === 465 ? PHPMailer::ENCRYPTION_SMTPS : PHPMailer::ENCRYPTION_STARTTLS;
    $mail->SMTPOptions = ['ssl' => ['verify_peer' => false, 'verify_peer_name' => false, 'allow_self_signed' => true]];
    $mail->CharSet = 'UTF-8';
    
    // From
    $mail->setFrom($smtp['user'] ?? '', $input['fromName'] ?? '');
    
    // To
    $to = $input['to'] ?? '';
    if (is_array($to)) {
        foreach ($to as $addr) { $mail->addAddress(trim($addr)); }
    } else {
        $mail->addAddress(trim($to));
    }
    
    // CC
    if (!empty($input['cc'])) {
        $cc = $input['cc'];
        if (is_array($cc)) { foreach ($cc as $addr) { $mail->addCC(trim($addr)); } }
        else { $mail->addCC(trim($cc)); }
    }
    
    // BCC
    if (!empty($input['bcc'])) {
        $bcc = $input['bcc'];
        if (is_array($bcc)) { foreach ($bcc as $addr) { $mail->addBCC(trim($addr)); } }
        else { $mail->addBCC(trim($bcc)); }
    }
    
    $mail->Subject = $input['subject'] ?? '(No Subject)';
    $mail->isHTML(true);
    $mail->Body    = $input['html'] ?? $input['body'] ?? '';
    $mail->AltBody = strip_tags($input['html'] ?? $input['body'] ?? '');
    
    $mail->send();
    echo json_encode(['success' => true, 'messageId' => $mail->getLastMessageID()]);
    
} catch (Exception $e) {
    echo json_encode(['success' => false, 'error' => 'Email failed: ' . $e->getMessage()]);
}
